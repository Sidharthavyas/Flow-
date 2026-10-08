"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type Status = "on" | "off" | "denied";
type Account = { label: string; enabled: boolean };
type Rule = { id: string; payee: string; band: string; kind: string; category: string };
// Exposed by the Android app (MainActivity); missing on the website and in app versions before 1.3.
type Bridge = { smsStatus: () => string; enableSms: () => void; disableSms: () => void };

const BAND_LABEL: Record<string, string> = { small: "up to ₹100", medium: "₹100–1,000", large: "over ₹1,000" };
const RULES_SHOWN = 6;

function bridge(): Bridge | null {
  return typeof window !== "undefined" ? ((window as unknown as { FlowAndroid?: Bridge }).FlowAndroid ?? null) : null;
}

export default function SmsSettings({ notify }: { notify: (message: string) => void }) {
  // The Profile sheet only renders after a tap, so reading the native bridge here never runs on the server.
  const [status, setStatus] = useState<Status | "web" | "old-app">(() => {
    const native = bridge();
    if (native) return native.smsStatus() as Status;
    return typeof navigator !== "undefined" && navigator.userAgent.includes("FlowAndroid") ? "old-app" : "web";
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const onStatus = (event: Event) => setStatus((event as CustomEvent<Status>).detail);
    window.addEventListener("flow-sms-status", onStatus);
    api<{ accounts: Account[]; rules: Rule[] }>("/api/sms/settings").then((r) => { setAccounts(r.accounts); setRules(r.rules); }).catch(() => undefined);
    return () => window.removeEventListener("flow-sms-status", onStatus);
  }, []);

  async function toggleAccount(account: Account) {
    const next = !account.enabled;
    setAccounts((list) => list.map((a) => (a.label === account.label ? { ...a, enabled: next } : a)));
    try { await api("/api/sms/settings", { method: "PATCH", body: JSON.stringify({ label: account.label, enabled: next }) }); }
    catch (e) { setAccounts((list) => list.map((a) => (a.label === account.label ? account : a))); notify(e instanceof Error ? e.message : "Couldn't save"); }
  }

  async function forget(rule: Rule) {
    setRules((list) => list.filter((r) => r.id !== rule.id));
    try { await api(`/api/sms/settings?rule=${rule.id}`, { method: "DELETE" }); notify(`Flow will ask about ${rule.payee} again`); }
    catch (e) { setRules((list) => [rule, ...list]); notify(e instanceof Error ? e.message : "Couldn't remove"); }
  }

  const native = status === "on" || status === "off" || status === "denied";
  return <section className="profile-section">
    <h3>Bank SMS</h3>
    <div className="profile-row">
      <div><strong>Auto-add from bank SMS</strong><small>{
        status === "web" ? "Works in the Flow Android app. Flow reads only bank debit messages, never your other SMS."
        : status === "old-app" ? "Update the Flow app (version 1.3 or newer) to turn this on."
        : status === "denied" ? "SMS permission is off. Tap to allow it, or enable it in Android Settings → Apps → Flow → Permissions."
        : "Payments from your bank SMS are added automatically. Only bank debit messages are read."
      }</small></div>
      {native && <button type="button" role="switch" aria-checked={status === "on"} aria-label="Auto-add from bank SMS" className={`switch ${status === "on" ? "on" : ""}`}
        onClick={() => { const b = bridge(); if (!b) return; if (status === "on") { b.disableSms(); setStatus("off"); } else b.enableSms(); }}><span /></button>}
    </div>

    {accounts.length > 0 && <div className="profile-row profile-row-stack">
      <div><strong>Accounts found</strong><small>Switch off any account you don&apos;t want Flow to track.</small></div>
      {accounts.map((account) => <div key={account.label} className="sms-account">
        <span>{account.label}</span>
        <button type="button" role="switch" aria-checked={account.enabled} aria-label={account.label} className={`switch ${account.enabled ? "on" : ""}`} onClick={() => void toggleAccount(account)}><span /></button>
      </div>)}
    </div>}

    {rules.length > 0 && <div className="profile-row profile-row-stack">
      <div><strong>What Flow has learned · {rules.length}</strong><small>Remove one and Flow will ask about that payee again.</small></div>
      <div className="sms-rules">{(showRules ? rules : rules.slice(0, RULES_SHOWN)).map((rule) => <span key={rule.id}>
        <b>{rule.payee}</b><small>{BAND_LABEL[rule.band] ?? rule.band} → {rule.kind === "transfer" ? "Not spending" : rule.category}</small>
        <button type="button" aria-label={`Forget ${rule.payee}`} onClick={() => void forget(rule)}>×</button>
      </span>)}</div>
      {rules.length > RULES_SHOWN && <button type="button" className="custom-category-toggle" onClick={() => setShowRules((v) => !v)}>{showRules ? "Show less" : `Show all ${rules.length}`}</button>}
    </div>}
  </section>;
}
