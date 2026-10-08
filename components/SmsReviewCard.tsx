"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Suggestion = { label: string; kind: "expense" | "transfer"; category?: string };
type Item = { id: string; amount: number; date: string; payee?: string; name: string; account?: string; category: string; suggestions: Suggestion[] };

const CATEGORIES = [
  "Food & Dining", "Groceries", "Travel & Transport", "Bills & Utilities", "Rent", "Shopping", "Entertainment", "Subscriptions",
  "Health", "Education", "EMI / Loan", "Insurance", "Personal Care", "Gifts", "Taxes", "Business Expense", "Inventory / Stock",
  "Office & Supplies", "Marketing", "Professional Fees", "Other",
];
const SHOWN = 4;

const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const shortDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

// Payments added from bank SMS that Flow couldn't place. They already count toward the budget; answering just sorts them,
// and Flow remembers the answer for that payee.
export default function SmsReviewCard({ onChanged, notify }: { onChanged: () => void; notify: (message: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    try { setItems((await api<{ items: Item[] }>("/api/sms/review")).items); } catch { /* not critical: try again on next focus */ }
  }, []);

  useEffect(() => {
    api<{ items: Item[] }>("/api/sms/review").then((r) => setItems(r.items)).catch(() => undefined);
    // SMS arrive while Flow is in the background; refresh when it comes back.
    const onVisible = () => { if (document.visibilityState === "visible") { void load(); onChanged(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, onChanged]);

  async function resolve(item: Item, kind: Suggestion["kind"], category?: string) {
    if (working) return;
    setWorking(item.id);
    try {
      const result = await api<{ message: string }>("/api/sms/resolve", { method: "POST", body: JSON.stringify({ expenseId: item.id, kind, category }) });
      notify(result.message);
      await load(); onChanged();
    } catch (e) { notify(e instanceof Error ? e.message : "Couldn't save that"); }
    finally { setWorking(""); }
  }

  if (!items.length) return null;
  const visible = showAll ? items : items.slice(0, SHOWN);

  return <section className="card-surface sms-review" aria-label="Payments to review">
    <div className="sms-review-head">
      <div><strong>To review · {items.length}</strong><small>From your bank SMS. Already counted in your budget; tap what each one was.</small></div>
    </div>
    <ul>{visible.map((item) => <li key={item.id} className={working === item.id ? "working" : ""}>
      <div className="sms-review-line">
        <span><strong>{item.payee || item.name}</strong><small>{shortDate(item.date)}{item.account ? ` · ${item.account}` : ""}</small></span>
        <b>{money(item.amount)}</b>
      </div>
      <div className="sms-review-actions">
        {item.suggestions.map((s) => <button key={s.label} type="button" disabled={Boolean(working)} className={s.kind === "transfer" ? "quiet" : ""} onClick={() => void resolve(item, s.kind, s.category)}>{s.label}</button>)}
        <select aria-label={`Other category for ${item.payee || item.name}`} value="" disabled={Boolean(working)} onChange={(e) => { if (e.target.value) void resolve(item, "expense", e.target.value); }}>
          <option value="">Other…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
    </li>)}</ul>
    {items.length > SHOWN && <button type="button" className="sms-review-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show less" : `Show all ${items.length}`}</button>}
  </section>;
}
