"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeForecast, expenseInsights, investmentInsights, paceStatusLabel, previousPeriodStart, savingsInsights, type Forecast, type Insight } from "@/lib/insights";
import { budgetNudge, type BudgetNudge as Nudge } from "@/lib/budget-nudge";
import { expenseRoast, typicalSpend, type ExpenseRoast } from "@/lib/expense-roast";
import { displayAddress } from "@/lib/nudges";
import ProfileSheet from "@/components/ProfileSheet";
import { api } from "@/lib/api-client";

type Period = "week" | "month";
type Page = "expenses" | "money";
type MoneyMode = "savings" | "investments";
type SavingAction = "opening" | "deposit" | "transfer" | "withdrawal";
type SheetName = "expense" | "investment" | "saving" | "budget" | "day" | "profile";
type User = { id: string; name: string; email: string; nickname: string; isAdmin?: boolean };
type Expense = {
  id: string; amount: number; category: string; date: string; name: string; payment: string;
  type: string; recurring: string; extra: string;
};
type Investment = {
  id: string; name: string; type: string; invested: number; current: number; date: string;
  frequency: string; rate: number | null; platform: string; maturity: string; note: string;
};
type Saving = {
  id: string; action: SavingAction; amount: number; date: string; fromAccount: string;
  toAccount: string; method: string; note: string;
};
type DayInfo = { date: string; spent: number; target: number; status: "none" | "good" | "equal" | "over" };
type PaceSummary = {
  days: DayInfo[]; spent: number; remaining: number; expected: number; delta: number; recorded: DayInfo[];
  good: number; daily: number; projection: number; dayCount: number; isCurrent: boolean;
};

type ExpenseDraft = Omit<Expense, "id">;
type InvestmentDraft = Omit<Investment, "id">;
type SavingDraft = Omit<Saving, "id">;

const EXPENSE_CATEGORIES = [
  "Food & Dining", "Groceries", "Travel & Transport", "Bills & Utilities", "Rent", "Shopping",
  "Entertainment", "Subscriptions", "Health", "Education", "EMI / Loan", "Insurance",
  "Personal Care", "Gifts", "Taxes", "Business Expense", "Inventory / Stock", "Office & Supplies",
  "Marketing", "Professional Fees", "Other",
];
const INVESTMENT_TYPES = ["SIP", "Mutual Fund", "Stocks", "FD", "RD", "PPF", "EPF", "NPS", "Bonds", "Gold", "REIT", "Other"];
const PAYMENT_METHODS = ["UPI", "Cash", "Credit Card", "Debit Card", "Bank Transfer", "IMPS", "NEFT", "RTGS", "Wallet", "Auto Debit", "Business Account", "Personal Account"];
const SAVING_METHODS = ["Bank Transfer", "UPI", "IMPS", "NEFT", "RTGS", "Auto Transfer", "Cash Deposit", "Cash Withdrawal", "Other"];
const PAGE_SIZE = 5;
const ROAST_SEEN_KEY = "flow-roast-seen";
const ROAST_EMOJI = { mild: "😬", hot: "🔥", inferno: "💀" } as const;

const EMPTY_EXPENSE: ExpenseDraft = { amount: 0, category: "", date: "", name: "", payment: "", type: "", recurring: "", extra: "" };
const EMPTY_INVESTMENT: InvestmentDraft = { name: "", type: "", invested: 0, current: 0, date: "", frequency: "", rate: null, platform: "", maturity: "", note: "" };
const EMPTY_SAVING: SavingDraft = { action: "deposit", amount: 0, date: "", fromAccount: "", toAccount: "", method: "Bank Transfer", note: "" };

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
function dateFromKey(value: string) { return new Date(`${value}T00:00:00`); }
function money(value: number) { return `₹${Math.round(value || 0).toLocaleString("en-IN")}`; }
function longDate(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(dateFromKey(value)); }
function fullDate(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(dateFromKey(value)); }
function startOfWeek(date: Date) {
  const x = new Date(date); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x;
}
function startOfPeriod(anchor: Date, period: Period) {
  const x = new Date(anchor); x.setHours(0, 0, 0, 0);
  if (period === "month") { x.setDate(1); return x; }
  return startOfWeek(x);
}
function endOfPeriod(anchor: Date, period: Period) {
  const x = startOfPeriod(anchor, period); const end = new Date(x);
  if (period === "month") end.setMonth(end.getMonth() + 1); else end.setDate(end.getDate() + 7);
  return end;
}
function periodTitle(anchor: Date, period: Period) {
  const start = startOfPeriod(anchor, period), end = endOfPeriod(anchor, period);
  if (period === "month") return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(start);
  const last = new Date(end); last.setDate(last.getDate() - 1);
  return `${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(start)} – ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(last)}`;
}
function expenseEmoji(category: string) {
  const c = category.toLowerCase();
  if (c.includes("food")) return "🍽️"; if (c.includes("grocer")) return "🛒"; if (c.includes("travel") || c.includes("transport")) return "🚕";
  if (c.includes("bill") || c.includes("utilit")) return "💡"; if (c.includes("rent")) return "🏠"; if (c.includes("shopping")) return "🛍️";
  if (c.includes("entertain")) return "🎬"; if (c.includes("subscription")) return "🔁"; if (c.includes("health")) return "❤️";
  if (c.includes("education")) return "📚"; if (c.includes("emi") || c.includes("loan")) return "🏦"; if (c.includes("insurance")) return "🛡️";
  if (c.includes("inventory") || c.includes("stock")) return "📦"; if (c.includes("business") || c.includes("office")) return "💼";
  if (c.includes("marketing")) return "📣"; if (c.includes("personal")) return "✨"; if (c.includes("gift")) return "🎁"; if (c.includes("tax")) return "🧾"; return "💸";
}
function investmentEmoji(type: string) {
  const t = type.toLowerCase();
  if (t.includes("sip") || t.includes("mutual")) return "📊"; if (t.includes("stock")) return "📈"; if (t === "fd" || t === "rd") return "🏦";
  if (t.includes("gold")) return "🪙"; if (t.includes("bond")) return "📜"; if (t.includes("ppf") || t.includes("epf") || t.includes("nps")) return "🌱";
  if (t.includes("reit")) return "🏢"; return "💰";
}
function savingEmoji(action: SavingAction) {
  if (action === "opening") return "🏦";
  if (action === "deposit") return "＋";
  if (action === "transfer") return "⇄";
  return "−";
}
function savingActionLabel(action: SavingAction) {
  if (action === "opening") return "Opening balance";
  if (action === "deposit") return "Saved / deposit";
  if (action === "transfer") return "Account transfer";
  return "Withdrawal / used";
}
function savingRoute(saving: Saving) {
  if (saving.action === "transfer") return `${saving.fromAccount} → ${saving.toAccount}`;
  if (saving.action === "withdrawal") return saving.fromAccount;
  return saving.toAccount;
}
function greeting(name?: string) {
  const now = new Date(), hour = now.getHours();
  const word = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = name?.trim();
  return `${word}${firstName ? `, ${firstName}` : ""} · ${new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(now)}`;
}
function applySavingToBalances(map: Map<string, number>, saving: Saving) {
  const add = (account: string, amount: number) => { if (account) map.set(account, (map.get(account) || 0) + amount); };
  if (saving.action === "opening" || saving.action === "deposit") add(saving.toAccount, saving.amount);
  if (saving.action === "withdrawal") add(saving.fromAccount, -saving.amount);
  if (saving.action === "transfer") { add(saving.fromAccount, -saving.amount); add(saving.toAccount, saving.amount); }
}

export default function FlowDashboard({ user: initialUser }: { user: User }) {
  const [user, setUser] = useState(initialUser);
  const [page, setPage] = useState<Page>("expenses");
  const [moneyMode, setMoneyMode] = useState<MoneyMode>("savings");
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [prevExpenses, setPrevExpenses] = useState<Expense[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [savings, setSavings] = useState<Saving[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [roastsEnabled, setRoastsEnabled] = useState(true);
  const [budget, setBudget] = useState(0);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [loadingInvestments, setLoadingInvestments] = useState(true);
  const [loadingSavings, setLoadingSavings] = useState(true);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>({ ...EMPTY_EXPENSE, date: localDateKey() });
  const [investmentDraft, setInvestmentDraft] = useState<InvestmentDraft>({ ...EMPTY_INVESTMENT, date: localDateKey() });
  const [savingDraft, setSavingDraft] = useState<SavingDraft>({ ...EMPTY_SAVING, date: localDateKey() });
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingInvestmentId, setEditingInvestmentId] = useState<string | null>(null);
  const [editingSavingId, setEditingSavingId] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState(0);
  const [selectedDay, setSelectedDay] = useState("");
  const [expenseSearch, setExpenseSearch] = useState("");
  const [investmentSearch, setInvestmentSearch] = useState("");
  const [savingSearch, setSavingSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [savingAccountFilter, setSavingAccountFilter] = useState("");
  const [rangeFilter, setRangeFilter] = useState<{ from: string; to: string } | null>(null);
  const [expenseListPage, setExpenseListPage] = useState(1);
  const [savingListPage, setSavingListPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useMemo(() => startOfPeriod(anchor, period), [anchor, period]);
  const end = useMemo(() => endOfPeriod(anchor, period), [anchor, period]);
  const startKey = localDateKey(start), endKey = localDateKey(end);
  const prevStartKey = localDateKey(previousPeriodStart(start, period));

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }, []);

  const loadExpenses = useCallback(async () => {
    setLoadingExpenses(true);
    try {
      const [expenseResult, budgetResult, prevResult] = await Promise.all([
        api<{ expenses: Expense[] }>(`/api/expenses?from=${startKey}&to=${endKey}`),
        api<{ budget: { amount: number } | null }>(`/api/budgets?periodType=${period}&periodStart=${startKey}`),
        api<{ expenses: Expense[] }>(`/api/expenses?from=${prevStartKey}&to=${startKey}`).catch(() => ({ expenses: [] as Expense[] })),
      ]);
      setExpenses(expenseResult.expenses);
      setPrevExpenses(prevResult.expenses);
      setBudget(budgetResult.budget?.amount ?? 0);
    } catch (e) { notify(e instanceof Error ? e.message : "Could not load expenses"); }
    finally { setLoadingExpenses(false); }
  }, [startKey, endKey, prevStartKey, period, notify]);

  const refreshInvestments = useCallback(async () => {
    setLoadingInvestments(true);
    try {
      const result = await api<{ investments: Investment[] }>("/api/investments");
      setInvestments(result.investments);
      return result.investments;
    } catch (e) { notify(e instanceof Error ? e.message : "Could not load investments"); return [] as Investment[]; }
    finally { setLoadingInvestments(false); }
  }, [notify]);

  const refreshSavings = useCallback(async () => {
    setLoadingSavings(true);
    try {
      const result = await api<{ savings: Saving[] }>("/api/savings");
      setSavings(result.savings);
      return result.savings;
    } catch (e) { notify(e instanceof Error ? e.message : "Could not load savings"); return [] as Saving[]; }
    finally { setLoadingSavings(false); }
  }, [notify]);

  const loadMoneySetup = useCallback(async () => {
    setLoadingInvestments(true); setLoadingSavings(true);
    try {
      const [preferenceResult, investmentResult, savingResult] = await Promise.all([
        api<{ moneyMode: MoneyMode | null; customExpenseCategories: string[]; roastsEnabled?: boolean }>("/api/preferences"),
        api<{ investments: Investment[] }>("/api/investments"),
        api<{ savings: Saving[] }>("/api/savings"),
      ]);
      setInvestments(investmentResult.investments);
      setSavings(savingResult.savings);
      setCustomCategories(preferenceResult.customExpenseCategories);
      setRoastsEnabled(preferenceResult.roastsEnabled !== false);
      setMoneyMode(preferenceResult.moneyMode ?? (investmentResult.investments.length ? "investments" : "savings"));
    } catch (e) { notify(e instanceof Error ? e.message : "Could not load your money setup"); }
    finally { setLoadingInvestments(false); setLoadingSavings(false); }
  }, [notify]);

  useEffect(() => { void loadExpenses(); setSelectedDay(""); setCategoryFilter(""); setRangeFilter(null); }, [loadExpenses]);
  useEffect(() => { void loadMoneySetup(); }, [loadMoneySetup]);
  useEffect(() => { setExpenseListPage(1); }, [expenseSearch, selectedDay, categoryFilter, rangeFilter, startKey, endKey]);
  useEffect(() => { setSavingListPage(1); }, [savingSearch, savingAccountFilter, startKey, endKey]);

  const pace = useMemo(() => {
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    const byDay = new Map<string, number>(); expenses.forEach((e) => byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount));
    let remaining = budget;
    const days: DayInfo[] = [];
    for (let i = 0; i < dayCount; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const key = localDateKey(d), spent = byDay.get(key) || 0;
      const target = budget ? Math.max(0, remaining / Math.max(1, dayCount - i)) : 0;
      const ratio = target ? spent / target : 0;
      const status: DayInfo["status"] = spent <= 0 || !budget ? "none" : ratio < .95 ? "good" : ratio <= 1.05 ? "equal" : "over";
      days.push({ date: key, spent, target, status }); remaining -= spent;
    }
    const spent = expenses.reduce((a, e) => a + e.amount, 0), today = localDateKey(), now = new Date();
    const isCurrent = now >= start && now < end;
    const isPast = now >= end;
    const todayIndex = days.findIndex((d) => d.date === today);
    const elapsed = isCurrent ? Math.max(1, todayIndex + 1) : isPast ? dayCount : 0;
    const expected = budget && dayCount ? budget * (elapsed / dayCount) : 0;
    const recorded = days.filter((d) => d.spent > 0), good = recorded.filter((d) => d.status === "good").length;
    const currentDay = days.find((d) => d.date === today);
    const daily = budget ? (isCurrent ? currentDay?.target || 0 : budget / Math.max(1, dayCount)) : 0;
    const projection = elapsed && expenses.length ? spent / elapsed * dayCount : spent;
    return { days, spent, remaining: budget - spent, expected, delta: expected - spent, recorded, good, daily, projection, dayCount, isCurrent };
  }, [expenses, budget, start, end]);

  const forecast = useMemo(() => computeForecast({ expenses, prevExpenses, budget, start, end, period }), [expenses, prevExpenses, budget, start, end, period]);
  const smartExpenseInsights = useMemo(() => expenseInsights({ expenses, prevExpenses, forecast, budget, period, start, days: pace.days }), [expenses, prevExpenses, forecast, budget, period, start, pace.days]);

  const categories = useMemo(() => {
    const map = new Map<string, number>(); expenses.forEach((e) => map.set(e.category, (map.get(e.category) || 0) + e.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const quickExpenseCategories = useMemo(() => {
    const seen = new Set<string>();
    return [...categories.map(([name]) => name), ...customCategories, ...EXPENSE_CATEGORIES]
      .filter((name) => { const key = name.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
      .slice(0, 5);
  }, [categories, customCategories]);

  const filteredExpenses = useMemo(() => {
    const query = expenseSearch.trim().toLowerCase();
    return [...expenses].filter((e) => {
      if (selectedDay && e.date !== selectedDay) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (rangeFilter && !(e.date >= rangeFilter.from && e.date < rangeFilter.to)) return false;
      return !query || [e.category, e.name, e.payment, e.type, e.recurring, e.extra].some((v) => v.toLowerCase().includes(query));
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [expenses, expenseSearch, selectedDay, categoryFilter, rangeFilter]);

  const expensePages = Math.max(1, Math.ceil(filteredExpenses.length / PAGE_SIZE));
  const pagedExpenses = filteredExpenses.slice((expenseListPage - 1) * PAGE_SIZE, expenseListPage * PAGE_SIZE);
  useEffect(() => { setExpenseListPage((current) => Math.min(current, expensePages)); }, [expensePages]);

  const filteredInvestments = useMemo(() => {
    const query = investmentSearch.trim().toLowerCase();
    return [...investments].filter((i) => !query || [i.name, i.type, i.platform, i.frequency].some((v) => v.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date));
  }, [investments, investmentSearch]);

  const investmentTotals = useMemo(() => {
    const invested = investments.reduce((a, i) => a + i.invested, 0), current = investments.reduce((a, i) => a + i.current, 0);
    return { invested, current, gain: current - invested };
  }, [investments]);

  const savingAccounts = useMemo(() => {
    const map = new Map<string, number>();
    [...savings].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).forEach((saving) => applySavingToBalances(map, saving));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [savings]);
  const savingAccountNames = useMemo(() => savingAccounts.map(([name]) => name), [savingAccounts]);
  const totalSavings = useMemo(() => savingAccounts.reduce((sum, [, amount]) => sum + amount, 0), [savingAccounts]);
  const periodSavings = useMemo(() => savings.filter((saving) => saving.date >= startKey && saving.date < endKey), [savings, startKey, endKey]);
  const savingStats = useMemo(() => ({
    saved: periodSavings.filter((s) => s.action === "deposit").reduce((sum, s) => sum + s.amount, 0),
    used: periodSavings.filter((s) => s.action === "withdrawal").reduce((sum, s) => sum + s.amount, 0),
    transferred: periodSavings.filter((s) => s.action === "transfer").reduce((sum, s) => sum + s.amount, 0),
    openings: periodSavings.filter((s) => s.action === "opening").reduce((sum, s) => sum + s.amount, 0),
  }), [periodSavings]);
  const monthlySpend = useMemo(() => {
    const prevTotal = prevExpenses.reduce((a, e) => a + e.amount, 0), current = forecast.isPast ? forecast.spent : forecast.forecast;
    const typical = prevTotal && current ? (prevTotal + current) / 2 : prevTotal || current;
    return period === "month" ? typical : typical * 30.44 / 7;
  }, [prevExpenses, forecast, period]);
  const smartSavingsInsights = useMemo(() => savingsInsights({ savings, totalSavings, saved: savingStats.saved, used: savingStats.used, periodSpent: forecast.spent, monthlySpend, period }), [savings, totalSavings, savingStats, forecast.spent, monthlySpend, period]);
  const smartInvestmentInsights = useMemo(() => investmentInsights({ investments }), [investments]);

  const address = displayAddress(user.nickname, user.name);
  const nudge = useMemo<Nudge | null>(() => {
    const next = budgetNudge({
      forecast, budget, days: pace.days, hasExpenses: expenses.length > 0, name: user.name, topCategory: categories[0]?.[0] ?? "", seed: user.id, address,
    });
    // With roasts switched off in Profile, Flow still celebrates good days but never roasts.
    return next?.tone === "roast" && !roastsEnabled ? null : next;
  }, [budget, forecast, expenses.length, user.name, user.id, categories, pace.days, address, roastsEnabled]);

  // Full-screen roast once per day, and again only if the alert escalates (e.g. today's allowance → budget crossed).
  const [seenRoast, setSeenRoast] = useState(() => { try { return window.localStorage.getItem(ROAST_SEEN_KEY) ?? ""; } catch { return ""; } });
  const roastKey = nudge?.tone === "roast" ? `${localDateKey()}|${nudge.label.split(" · ")[0]}|${nudge.level}` : "";
  // The server may swap in an AI-written line for today (cached, so it matches the 9 PM notification).
  const [dailyLine, setDailyLine] = useState<{ key: string; line: string | null }>({ key: "", line: null });
  useEffect(() => {
    if (!roastKey || loadingExpenses) return;
    let cancelled = false;
    const settle = (line: string | null) => { if (!cancelled) setDailyLine((d) => (d.key === roastKey ? d : { key: roastKey, line })); };
    const timer = setTimeout(() => settle(null), 5000);
    api<{ show?: boolean; tone?: string; body?: string }>(`/api/nudge?date=${localDateKey()}&slot=app`)
      .then((r) => settle(r.show && r.tone === "roast" && r.body ? r.body : null))
      .catch(() => settle(null))
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [roastKey, loadingExpenses]);
  const dailyReady = dailyLine.key === roastKey;
  const shownNudge = nudge && dailyReady && dailyLine.line ? { ...nudge, line: dailyLine.line } : nudge;
  const [expensePop, setExpensePop] = useState<(ExpenseRoast & { id: number; ready: boolean }) | null>(null);
  const showRoastTakeover = Boolean(roastKey) && !loadingExpenses && dailyReady && !expensePop && seenRoast !== roastKey;
  function markRoastSeen() {
    setSeenRoast(roastKey);
    try { window.localStorage.setItem(ROAST_SEEN_KEY, roastKey); } catch { /* private mode: it just shows again next launch */ }
  }
  function dismissRoast() { markRoastSeen(); }
  function closeExpensePop() {
    // The expense roast already made the point; don't stack the daily takeover right after it.
    setExpensePop(null); markRoastSeen();
  }
  const expensePopId = useRef(0);
  function showExpenseRoast(roast: ExpenseRoast, spentAfter: number) {
    const id = ++expensePopId.current;
    setExpensePop({ ...roast, id, ready: false });
    const finish = (line: string | null) => setExpensePop((p) => (p && p.id === id && !p.ready ? { ...p, line: line || p.line, ready: true } : p));
    const timer = setTimeout(() => finish(null), 4500);
    api<{ line: string | null }>("/api/roast", { method: "POST", body: JSON.stringify({
      level: roast.level, situation: roast.title, amount: expenseDraft.amount, category: expenseDraft.category,
      description: expenseDraft.name || undefined, typicalSpend: Number(roast.vars.typical.replace(/[^\d]/g, "")) || undefined,
      budget: budget || undefined, spentAfter, time: roast.vars.time,
    }) }).then((r) => finish(r.line)).catch(() => finish(null)).finally(() => clearTimeout(timer));
  }
  async function shareRoast(line = shownNudge?.line) {
    if (!line) return;
    const text = `“${line}”\n— Flow roasted me today 🔥`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text); notify("Roast copied — ab doston ko bhej");
    } catch { /* share sheet cancelled */ }
  }

  const filteredSavings = useMemo(() => {
    const query = savingSearch.trim().toLowerCase();
    return [...periodSavings].filter((saving) => {
      if (savingAccountFilter && saving.fromAccount !== savingAccountFilter && saving.toAccount !== savingAccountFilter) return false;
      return !query || [saving.fromAccount, saving.toAccount, saving.method, saving.note, savingActionLabel(saving.action)].some((v) => v.toLowerCase().includes(query));
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [periodSavings, savingSearch, savingAccountFilter]);
  const savingPages = Math.max(1, Math.ceil(filteredSavings.length / PAGE_SIZE));
  const pagedSavings = filteredSavings.slice((savingListPage - 1) * PAGE_SIZE, savingListPage * PAGE_SIZE);
  useEffect(() => { setSavingListPage((current) => Math.min(current, savingPages)); }, [savingPages]);

  function shiftPeriod(by: number) {
    setAnchor((prev) => {
      const next = new Date(prev);
      if (period === "month") next.setMonth(next.getMonth() + by, 1); else next.setDate(next.getDate() + by * 7);
      return next;
    });
  }
  function clearFilters() { setSelectedDay(""); setCategoryFilter(""); setRangeFilter(null); setExpenseSearch(""); }
  function openNew(kind: "expense" | "investment" | "saving") {
    if (kind === "expense") {
      setEditingExpenseId(null);
      setExpenseDraft({ ...EMPTY_EXPENSE, date: localDateKey(new Date(Math.max(start.getTime(), Math.min(Date.now(), end.getTime() - 1)))) });
    } else if (kind === "investment") {
      setEditingInvestmentId(null); setInvestmentDraft({ ...EMPTY_INVESTMENT, date: localDateKey() });
    } else {
      setEditingSavingId(null); setSavingDraft({ ...EMPTY_SAVING, date: localDateKey() });
    }
    setSheet(kind);
  }
  function editExpense(expense: Expense) { setEditingExpenseId(expense.id); setExpenseDraft({ ...expense }); setSheet("expense"); }
  function editInvestment(investment: Investment) { setEditingInvestmentId(investment.id); setInvestmentDraft({ ...investment }); setSheet("investment"); }
  function editSaving(saving: Saving) { setEditingSavingId(saving.id); setSavingDraft({ ...saving }); setSheet("saving"); }

  async function saveRoastsEnabled(next: boolean) {
    const previous = roastsEnabled; setRoastsEnabled(next);
    try { await api("/api/preferences", { method: "PATCH", body: JSON.stringify({ roastsEnabled: next }) }); notify(next ? "Roasts are on" : "Roasts are off"); }
    catch (e) { setRoastsEnabled(previous); notify(e instanceof Error ? e.message : "Could not save preference"); }
  }
  async function saveMoneyMode(nextMode: MoneyMode) {
    if (nextMode === moneyMode) return;
    const previous = moneyMode; setMoneyMode(nextMode);
    try { await api("/api/preferences", { method: "PATCH", body: JSON.stringify({ moneyMode: nextMode }) }); }
    catch (e) { setMoneyMode(previous); notify(e instanceof Error ? e.message : "Could not save preference"); }
  }

  async function addCustomCategory(raw: string) {
    const name = raw.trim();
    if (!name) return null;
    const existing = [...customCategories, ...EXPENSE_CATEGORIES].find((item) => item.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const previous = customCategories;
    const next = [...customCategories, name];
    setCustomCategories(next);
    try {
      const result = await api<{ customExpenseCategories: string[] }>("/api/preferences", { method: "PATCH", body: JSON.stringify({ customExpenseCategories: next }) });
      setCustomCategories(result.customExpenseCategories);
      notify("Custom category added");
      return name;
    } catch (e) {
      setCustomCategories(previous);
      notify(e instanceof Error ? e.message : "Could not add category");
      return null;
    }
  }

  async function saveExpense(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const url = editingExpenseId ? `/api/expenses/${editingExpenseId}` : "/api/expenses";
      const method = editingExpenseId ? "PATCH" : "POST";
      // Judge a new expense against the numbers as they were just before it.
      const inCurrentPeriod = forecast.isCurrent && expenseDraft.date >= startKey && expenseDraft.date < endKey;
      const roast = editingExpenseId || !roastsEnabled ? null : expenseRoast({
        expense: expenseDraft, budget, spentBefore: forecast.spent, leftTodayBefore: forecast.leftToday, inCurrentPeriod,
        isToday: expenseDraft.date === localDateKey(), typical: typicalSpend([...expenses, ...prevExpenses]), address,
      });
      await api(url, { method, body: JSON.stringify(expenseDraft) });
      await loadExpenses(); setSheet(null);
      if (roast) showExpenseRoast(roast, expenseDraft.amount + (inCurrentPeriod ? forecast.spent : 0));
      else notify(editingExpenseId ? "Expense updated" : "Expense added");
    } catch (e) { notify(e instanceof Error ? e.message : "Could not save expense"); }
    finally { setBusy(false); }
  }
  async function deleteExpense() {
    if (!editingExpenseId || busy) return; setBusy(true);
    try { await api(`/api/expenses/${editingExpenseId}`, { method: "DELETE" }); await loadExpenses(); setSheet(null); notify("Expense deleted"); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not delete expense"); }
    finally { setBusy(false); }
  }
  async function saveInvestment(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const url = editingInvestmentId ? `/api/investments/${editingInvestmentId}` : "/api/investments";
      const method = editingInvestmentId ? "PATCH" : "POST";
      await api(url, { method, body: JSON.stringify(investmentDraft) });
      await refreshInvestments(); setSheet(null); notify(editingInvestmentId ? "Investment updated" : "Investment added");
    } catch (e) { notify(e instanceof Error ? e.message : "Could not save investment"); }
    finally { setBusy(false); }
  }
  async function deleteInvestment() {
    if (!editingInvestmentId || busy) return; setBusy(true);
    try { await api(`/api/investments/${editingInvestmentId}`, { method: "DELETE" }); await refreshInvestments(); setSheet(null); notify("Investment deleted"); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not delete investment"); }
    finally { setBusy(false); }
  }
  async function saveSaving(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const url = editingSavingId ? `/api/savings/${editingSavingId}` : "/api/savings";
      const method = editingSavingId ? "PATCH" : "POST";
      await api(url, { method, body: JSON.stringify(savingDraft) });
      await refreshSavings(); setSheet(null); notify(editingSavingId ? "Savings activity updated" : "Savings activity added");
    } catch (e) { notify(e instanceof Error ? e.message : "Could not save savings activity"); }
    finally { setBusy(false); }
  }
  async function deleteSaving() {
    if (!editingSavingId || busy) return; setBusy(true);
    try { await api(`/api/savings/${editingSavingId}`, { method: "DELETE" }); await refreshSavings(); setSheet(null); notify("Savings activity deleted"); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not delete savings activity"); }
    finally { setBusy(false); }
  }
  async function saveBudget(event: FormEvent) {
    event.preventDefault(); if (!budgetDraft || busy) return; setBusy(true);
    try {
      await api("/api/budgets", { method: "PUT", body: JSON.stringify({ periodType: period, periodStart: startKey, amount: budgetDraft }) });
      setBudget(budgetDraft); setSheet(null); notify("Budget saved");
    } catch (e) { notify(e instanceof Error ? e.message : "Could not save budget"); }
    finally { setBusy(false); }
  }
  async function signOut() {
    if (busy) return; setBusy(true);
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); window.location.assign("/login"); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not sign out"); setBusy(false); }
  }

  const expenseInsight = useMemo(() => {
    if (!budget && !expenses.length) return "Set a budget or add an expense and Flow will show one useful action here.";
    if (!budget) return forecast.isCurrent && expenses.length ? `You’ve spent ${money(pace.spent)} and are heading for about ${money(forecast.forecast)} this ${period}. Set a budget to unlock daily allowance and alerts.` : `You’ve spent ${money(pace.spent)} this ${period}. Set a budget to unlock pace and daily allowance.`;
    if (!pace.isCurrent) return pace.remaining >= 0 ? `You finished this period ${money(pace.remaining)} under budget.` : `This period ended ${money(Math.abs(pace.remaining))} over budget.`;
    if (pace.remaining < 0) return `You’re ${money(Math.abs(pace.remaining))} over budget. Keep the rest of this period intentionally light.`;
    if (forecast.runOutDate) return `At your recent ${money(forecast.dailyRate)}/day the budget runs out around ${longDate(forecast.runOutDate)}. Keep today under ${money(forecast.safeToday)} to push that out.`;
    if (expenses.length && forecast.forecast > budget) return `You’re heading for about ${money(forecast.forecast - budget)} over budget. Spending ${money(forecast.safeToday)} or less a day lands you on budget.`;
    if (expenses.length) return `You’re heading for ${money(forecast.forecast)} — about ${money(budget - forecast.forecast)} under budget. You can spend ${money(forecast.safeToday)} today.`;
    return `Your current daily allowance is ${money(forecast.safeToday)}. It will adjust automatically as you spend.`;
  }, [budget, expenses.length, pace, period, forecast]);

  const savingsInsight = useMemo(() => {
    if (!savings.length) return "Start with an opening balance, then record deposits, withdrawals and transfers. Transfers move money without increasing your total savings.";
    const negativeAccounts = savingAccounts.filter(([, amount]) => amount < 0);
    if (negativeAccounts.length) return `${negativeAccounts[0][0]} is below zero in Flow. Check whether an opening balance or earlier deposit is missing.`;
    if (savingStats.transferred > 0) return `${money(savingStats.transferred)} moved between your own accounts this ${period}. Flow keeps transfers neutral so savings are not double-counted.`;
    const net = savingStats.saved - savingStats.used;
    if (net > 0) return `Your savings increased by ${money(net)} from new saving activity this ${period}, excluding account transfers and opening balances.`;
    if (net < 0) return `You used ${money(Math.abs(net))} more than you newly saved this ${period}. Your account balances still include earlier savings.`;
    return "Your account balances are reconciled from the activity you record, so transfers never inflate the total.";
  }, [savings.length, savingAccounts, savingStats, period]);

  const secondaryLabel = moneyMode === "savings" ? "Savings" : "Investments";
  const secondaryIcon = moneyMode === "savings" ? "💰" : "📈";
  const addKind = page === "expenses" ? "expense" : moneyMode === "savings" ? "saving" : "investment";
  const showPeriodControls = page === "expenses" || moneyMode === "savings";

  return (
    <div className="flow-app">
      <aside className="desktop-rail" aria-label="Main navigation">
        <div className="rail-brand">Flow</div>
        <button className={`rail-tab ${page === "expenses" ? "active" : ""}`} onClick={() => setPage("expenses")}><span>🧾</span>Expenses</button>
        <button className={`rail-tab ${page === "money" ? "active" : ""}`} onClick={() => setPage("money")}><span>{secondaryIcon}</span>{secondaryLabel}</button>
        <button className="rail-add" onClick={() => openNew(addKind)}>＋ Add {addKind === "saving" ? "saving" : addKind}</button>
        <div className="rail-spacer" />
        <button className="rail-user" onClick={() => setSheet("profile")}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></button>
      </aside>

      <div className="flow-main">
        <header className="app-header">
          <div className="header-brand">Flow</div>
          <div className="header-actions">
            <a className="export-button" href="/api/export"><span>⇩</span> Export</a>
            <button className="profile-button" onClick={() => setSheet("profile")} aria-label="Account">{user.name.slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <main className="content">
          <section className="page-heading">
            <p className="greeting"><strong>{greeting(address).split(" · ")[0]}</strong> · {greeting(address).split(" · ")[1]}</p>
            <div className="heading-line">
              <div>
                <p className="kicker">{page === "expenses" ? "Personal money" : moneyMode === "savings" ? "Cash reserves" : "Long-term money"}</p>
                <h1>{page === "expenses" ? "Expenses" : secondaryLabel}</h1>
              </div>
              {page === "money" && <div className="money-mode-switch" aria-label="Choose money view">
                <button className={moneyMode === "savings" ? "active" : ""} onClick={() => void saveMoneyMode("savings")}>Savings</button>
                <button className={moneyMode === "investments" ? "active" : ""} onClick={() => void saveMoneyMode("investments")}>Investments</button>
              </div>}
            </div>
            {showPeriodControls && <div className="period-controls">
              <div className="period-nav"><button onClick={() => shiftPeriod(-1)} aria-label="Previous period">‹</button><strong>{periodTitle(anchor, period)}</strong><button onClick={() => shiftPeriod(1)} aria-label="Next period">›</button></div>
              <div className="period-right"><button className="today-button" onClick={() => setAnchor(new Date())}>Today</button><div className="segmented"><button className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>Week</button><button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>Month</button></div></div>
            </div>}
          </section>

          {page === "expenses" ? (
            <ExpensesView loading={loadingExpenses} budget={budget} pace={pace} forecast={forecast} smartInsights={smartExpenseInsights} nudge={shownNudge} insight={expenseInsight} expenses={expenses} categories={categories}
              filteredExpenses={filteredExpenses} pagedExpenses={pagedExpenses} selectedDay={selectedDay} period={period} anchor={anchor} start={start}
              setSheet={setSheet} setBudgetDraft={setBudgetDraft} onEdit={editExpense} onSelectDay={(day) => { setSelectedDay(day); setSheet("day"); }}
              categoryFilter={categoryFilter} onCategory={(cat) => { setCategoryFilter(cat); setSelectedDay(""); setRangeFilter(null); }}
              expenseSearch={expenseSearch} setExpenseSearch={setExpenseSearch} onRange={(range) => { setRangeFilter(range); setSelectedDay(""); setCategoryFilter(""); }}
              rangeFilter={rangeFilter} clearFilters={clearFilters} onAdd={() => openNew("expense")} page={expenseListPage} pages={expensePages} setPage={setExpenseListPage} />
          ) : moneyMode === "savings" ? (
            <SavingsView loading={loadingSavings} total={totalSavings} stats={savingStats} insight={savingsInsight} smartInsights={smartSavingsInsights} accounts={savingAccounts}
              savings={periodSavings} filteredSavings={filteredSavings} pagedSavings={pagedSavings} accountFilter={savingAccountFilter} setAccountFilter={setSavingAccountFilter}
              search={savingSearch} setSearch={setSavingSearch} period={period} onEdit={editSaving} onAdd={() => openNew("saving")}
              page={savingListPage} pages={savingPages} setPage={setSavingListPage} />
          ) : (
            <InvestmentsView loading={loadingInvestments} smartInsights={smartInvestmentInsights} investments={filteredInvestments} allInvestments={investments} totals={investmentTotals}
              search={investmentSearch} setSearch={setInvestmentSearch} onEdit={editInvestment} onAdd={() => openNew("investment")} />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <button className={page === "expenses" ? "active" : ""} onClick={() => setPage("expenses")}><span>🧾</span><small>Expenses</small></button>
        <button className="mobile-fab" onClick={() => openNew(addKind)} aria-label={`Add ${addKind}`}>＋</button>
        <button className={page === "money" ? "active" : ""} onClick={() => setPage("money")}><span>{secondaryIcon}</span><small>{secondaryLabel}</small></button>
      </nav>

      {sheet && <Sheet onClose={() => setSheet(null)}>
        {sheet === "expense" && <ExpenseForm draft={expenseDraft} setDraft={setExpenseDraft} editing={Boolean(editingExpenseId)} busy={busy} onSubmit={saveExpense} onDelete={deleteExpense} customCategories={customCategories} quickCategories={quickExpenseCategories} onAddCustomCategory={addCustomCategory} />}
        {sheet === "investment" && <InvestmentForm draft={investmentDraft} setDraft={setInvestmentDraft} editing={Boolean(editingInvestmentId)} busy={busy} onSubmit={saveInvestment} onDelete={deleteInvestment} />}
        {sheet === "saving" && <SavingForm draft={savingDraft} setDraft={setSavingDraft} editing={Boolean(editingSavingId)} busy={busy} onSubmit={saveSaving} onDelete={deleteSaving} accountNames={savingAccountNames} />}
        {sheet === "budget" && <BudgetForm period={period} value={budgetDraft} setValue={setBudgetDraft} busy={busy} onSubmit={saveBudget} />}
        {sheet === "day" && <DaySheet day={selectedDay} days={pace.days} expenses={expenses} budget={budget} onView={() => setSheet(null)} />}
        {sheet === "profile" && <ProfileSheet user={user} onUserChange={setUser} busy={busy} onSignOut={signOut} notify={notify}
          roastsEnabled={roastsEnabled} onRoastsEnabled={(value) => void saveRoastsEnabled(value)} moneyMode={moneyMode} onMoneyMode={(value) => void saveMoneyMode(value)}
          customCategories={customCategories} onCustomCategories={setCustomCategories} />}
      </Sheet>}
      {expensePop && <ExpenseRoastPop roast={expensePop} onClose={closeExpensePop} onShare={() => void shareRoast(expensePop.line)} />}
      {showRoastTakeover && shownNudge && <RoastTakeover nudge={shownNudge} spent={forecast.spent} budget={budget} forecast={forecast.forecast} onClose={dismissRoast} onShare={() => void shareRoast()} />}
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </div>
  );
}

function ExpensesView(props: {
  loading: boolean; budget: number; pace: PaceSummary; forecast: Forecast; smartInsights: Insight[]; nudge: Nudge | null; insight: string; expenses: Expense[]; categories: [string, number][];
  filteredExpenses: Expense[]; pagedExpenses: Expense[]; selectedDay: string; period: Period; anchor: Date; start: Date;
  setSheet: (s: SheetName) => void; setBudgetDraft: (v: number) => void; onEdit: (e: Expense) => void; onSelectDay: (d: string) => void;
  categoryFilter: string; onCategory: (cat: string) => void; expenseSearch: string; setExpenseSearch: (s: string) => void;
  onRange: (range: { from: string; to: string }) => void; rangeFilter: { from: string; to: string } | null; clearFilters: () => void; onAdd: () => void;
  page: number; pages: number; setPage: (page: number) => void;
}) {
  const { loading, budget, pace, forecast, smartInsights, nudge, insight, expenses, categories, filteredExpenses, pagedExpenses, selectedDay, period, anchor, start, setSheet, setBudgetDraft, onEdit, onSelectDay, categoryFilter, onCategory, expenseSearch, setExpenseSearch, onRange, rangeFilter, clearFilters, onAdd, page, pages, setPage } = props;
  const usedPct = budget ? Math.max(0, pace.spent / budget * 100) : 0;
  const finish = forecast.isPast ? forecast.spent : forecast.forecast;
  const anyFilter = Boolean(selectedDay || categoryFilter || expenseSearch || rangeFilter);
  return <div className="page-enter">
    {nudge && <NudgeCard nudge={nudge} />}
    <div className="summary-grid">
      <section className="budget-hero card-surface">
        <p>{period === "month" ? "Monthly" : "Weekly"} budget</p>
        <h2 className={budget && pace.remaining < 0 ? "negative" : ""}>{budget ? money(Math.abs(pace.remaining)) : money(pace.spent)}</h2>
        <div className="hero-copy">{budget ? pace.remaining >= 0 ? "left this period" : "over budget" : expenses.length ? "spent · set a budget to see pace" : "Set a budget to start tracking your pace."}</div>
        <div className="budget-track"><div className={usedPct > 100 ? "over" : ""} style={{ width: `${Math.min(100, usedPct)}%` }} /></div>
        <div className="budget-footer"><span>{budget ? `${money(pace.spent)} of ${money(budget)} · ${Math.round(usedPct)}% used` : "No budget yet"}</span><button onClick={() => { setBudgetDraft(budget); setSheet("budget"); }}>{budget ? "Edit budget" : "Set budget"}</button></div>
      </section>
      <div className="stat-grid">
        <Stat label="Today's allowance" value={budget ? money(forecast.safeToday) : "—"} note={!budget ? "Set a budget first" : !forecast.isCurrent ? "Average per day" : forecast.leftToday >= 0 ? `${money(forecast.leftToday)} left today` : `${money(-forecast.leftToday)} over today`} tone={budget && forecast.isCurrent && forecast.leftToday < 0 ? "bad" : undefined} />
        <Stat label={forecast.isPast ? "Finished at" : "Forecast"} value={expenses.length ? money(finish) : "—"} note={!expenses.length ? "Add expenses to forecast" : !budget ? `by end of ${period}` : finish <= budget ? `${money(budget - finish)} under budget` : `${money(finish - budget)} over budget`} tone={budget && expenses.length ? finish <= budget ? "good" : "bad" : undefined} />
        <Stat label="Days on budget" value={pace.recorded.length ? `${pace.good}/${pace.recorded.length}` : "0"} note={pace.recorded.length ? "recorded days below allowance" : "No recorded days yet"} />
      </div>
    </div>
    <div className="insight"><span>i</span><p>{insight}</p></div>
    <section className="section-block">
      <SectionTitle title="Spending pace" note="Spent so far, the budget pace line, and where you're heading." action={budget && expenses.length ? <span className={`pace-pill ${forecast.status}`}>{paceStatusLabel(forecast.status)}</span> : undefined} />
      <div className="card-surface chart-surface">
        {loading ? <Skeleton height={180} /> : <PaceChart budget={budget} forecast={forecast} start={start} hasExpenses={expenses.length > 0} />}
        {!!expenses.length && <ActivityChart expenses={expenses} period={period} start={start} budget={budget} dayCount={forecast.dayCount} todayIndex={forecast.todayIndex} onRange={onRange} />}
      </div>
    </section>
    {!loading && smartInsights.length > 0 && <SmartInsights title="Flow noticed" note="Patterns from your spending this period." insights={smartInsights} />}
    <div className="two-column">
      <section className="section-block"><SectionTitle title="Calendar" note="Tap a day to see how it went." /><Calendar period={period} anchor={anchor} days={pace.days} selectedDay={selectedDay} onSelect={onSelectDay} /></section>
      <section className="section-block"><SectionTitle title="Categories" note="Where your money went." /><CategoryList categories={categories} total={pace.spent} active={categoryFilter} onSelect={onCategory} /></section>
    </div>
    <section className="section-block recent" id="recent-expenses"><SectionTitle title="Recent expenses" note={expenses.length ? `${filteredExpenses.length} matching · latest 5 per page` : "No expenses yet."} action={anyFilter ? <button onClick={clearFilters}>Clear filter</button> : undefined} />
      <div className="list-card">
        {expenses.length >= 4 && <div className="search-row"><input value={expenseSearch} onChange={(e) => setExpenseSearch(e.target.value)} placeholder="Search expenses" /></div>}
        {pagedExpenses.length ? pagedExpenses.map((e) => <button className="money-row" key={e.id} onClick={() => onEdit(e)}><span className="row-icon">{expenseEmoji(e.category)}</span><span className="row-main"><strong>{e.category}</strong><small className="row-description">{[e.name, longDate(e.date), e.payment].filter(Boolean).join(" · ")}</small></span><b>{money(e.amount)}</b></button>) : <Empty title={expenses.length ? "Nothing matches this filter" : "Your spending starts here"} copy={expenses.length ? "Clear the filter to see your expenses again." : "Add your first expense and the dashboard builds itself."} action={!expenses.length ? <button className="empty-action" onClick={onAdd}>＋ Add first expense</button> : undefined} />}
        {filteredExpenses.length > PAGE_SIZE && <Pagination page={page} pages={pages} setPage={setPage} label="expense pages" />}
      </div>
    </section>
  </div>;
}

function SavingsView({ loading, total, stats, insight, smartInsights, accounts, savings, filteredSavings, pagedSavings, accountFilter, setAccountFilter, search, setSearch, period, onEdit, onAdd, page, pages, setPage }: {
  loading: boolean; total: number; stats: { saved: number; used: number; transferred: number; openings: number }; insight: string; smartInsights: Insight[];
  accounts: [string, number][]; savings: Saving[]; filteredSavings: Saving[]; pagedSavings: Saving[]; accountFilter: string; setAccountFilter: (value: string) => void;
  search: string; setSearch: (value: string) => void; period: Period; onEdit: (saving: Saving) => void; onAdd: () => void; page: number; pages: number; setPage: (page: number) => void;
}) {
  const net = stats.saved - stats.used;
  return <div className="page-enter">
    <section className="investment-hero savings-hero card-surface">
      <div><p>Total savings</p><h2 className={total < 0 ? "negative" : ""}>{money(total)}</h2><div className="hero-copy">Across the accounts you track in Flow</div></div>
      <div className="investment-mini">
        <Stat label={`Saved this ${period}`} value={money(stats.saved)} note="New deposits only" tone={stats.saved > 0 ? "good" : undefined} />
        <Stat label="Net change" value={`${net >= 0 ? "+" : "−"}${money(Math.abs(net))}`} note="Deposits minus withdrawals" tone={net >= 0 ? "good" : "bad"} />
      </div>
    </section>
    <div className="insight savings-insight"><span>i</span><p>{insight}</p></div>
    {!loading && smartInsights.length > 0 && <SmartInsights title="Savings health" note="Emergency cover, savings rate and habits." insights={smartInsights} />}
    <div className="two-column investment-columns">
      <section className="section-block"><SectionTitle title="Savings accounts" note="Tap an account to filter this period's activity." /><AccountList accounts={accounts} total={total} active={accountFilter} onSelect={setAccountFilter} /></section>
      <section className="section-block"><SectionTitle title="This period" note="Transfers are tracked separately and stay neutral." /><div className="card-surface savings-summary">{loading ? <Skeleton height={150} /> : <><Stat label="Withdrawn / used" value={money(stats.used)} note="Money moved out of savings" /><Stat label="Account transfers" value={money(stats.transferred)} note="Moved between your accounts" /><Stat label="Opening balances" value={money(stats.openings)} note="Setup amounts, not new saving" /></>}</div></section>
    </div>
    <section className="section-block"><SectionTitle title="Savings activity" note={savings.length ? `${filteredSavings.length} matching · latest 5 per page` : "No activity in this period."} action={accountFilter ? <button onClick={() => setAccountFilter("")}>Clear account</button> : undefined} />
      <div className="list-card">
        {savings.length >= 4 && <div className="search-row"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search savings activity" /></div>}
        {pagedSavings.length ? pagedSavings.map((saving) => <button className="money-row saving-row" key={saving.id} onClick={() => onEdit(saving)}><span className={`row-icon saving-icon ${saving.action}`}>{savingEmoji(saving.action)}</span><span className="row-main"><strong>{savingActionLabel(saving.action)}</strong><small className="row-description">{[savingRoute(saving), saving.method, longDate(saving.date)].filter(Boolean).join(" · ")}</small></span><span className="row-values"><b className={saving.action === "withdrawal" ? "negative" : saving.action === "transfer" ? "" : "positive"}>{saving.action === "withdrawal" ? "−" : saving.action === "transfer" ? "" : "+"}{money(saving.amount)}</b>{saving.note && <small>{saving.note}</small>}</span></button>) : <Empty title={savings.length ? "Nothing matches this filter" : "Start tracking your savings"} copy={savings.length ? "Try another search or clear the account filter." : "Add an opening balance or your first deposit. Flow will keep transfers from being double-counted."} action={!savings.length ? <button className="empty-action" onClick={onAdd}>＋ Add savings activity</button> : undefined} />}
        {filteredSavings.length > PAGE_SIZE && <Pagination page={page} pages={pages} setPage={setPage} label="savings pages" />}
      </div>
    </section>
  </div>;
}

function InvestmentsView({ loading, smartInsights, investments, allInvestments, totals, search, setSearch, onEdit, onAdd }: { loading: boolean; smartInsights: Insight[]; investments: Investment[]; allInvestments: Investment[]; totals: { invested: number; current: number; gain: number }; search: string; setSearch: (s: string) => void; onEdit: (i: Investment) => void; onAdd: () => void }) {
  return <div className="page-enter">
    <section className="investment-hero card-surface"><div><p>Current value</p><h2>{money(totals.current)}</h2></div><div className="investment-mini"><Stat label="Invested" value={money(totals.invested)} note="Total principal" /><Stat label="Gain / loss" value={`${totals.gain >= 0 ? "+" : "−"}${money(Math.abs(totals.gain))}`} note="Current vs invested" tone={totals.gain >= 0 ? "good" : "bad"} /></div></section>
    {!loading && smartInsights.length > 0 && <SmartInsights title="Portfolio check" note="Growth, concentration and maturities." insights={smartInsights} />}
    <div className="two-column investment-columns">
      <section className="section-block"><SectionTitle title="Allocation" note="Simple, not a trading dashboard." /><Allocation investments={allInvestments} total={totals.current} /></section>
      <section className="section-block"><SectionTitle title="Portfolio position" note="Invested vs current value." /><div className="card-surface portfolio-bars">{loading ? <Skeleton height={160} /> : <PortfolioBars invested={totals.invested} current={totals.current} />}</div></section>
    </div>
    <section className="section-block"><SectionTitle title="Your investments" note={allInvestments.length ? `${investments.length} of ${allInvestments.length} shown` : "No holdings yet."} />
      <div className="list-card">{allInvestments.length >= 4 && <div className="search-row"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search investments" /></div>}
        {investments.length ? investments.map((i) => { const gain = i.current - i.invested; return <button className="money-row" key={i.id} onClick={() => onEdit(i)}><span className="row-icon">{investmentEmoji(i.type)}</span><span className="row-main"><strong>{i.name}</strong><small>{i.type}{i.platform ? ` · ${i.platform}` : ""}</small></span><span className="row-values"><b>{money(i.current)}</b><small className={gain >= 0 ? "positive" : "negative"}>{gain >= 0 ? "+" : "−"}{money(Math.abs(gain))}</small></span></button>; }) : <Empty title="Start your portfolio" copy="Track SIPs, FDs, stocks and more in one calm view." action={<button className="empty-action" onClick={onAdd}>＋ Add first investment</button>} />}
      </div>
    </section>
  </div>;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "bad" }) { return <div className="stat-card"><span>{label}</span><strong className={tone === "good" ? "positive" : tone === "bad" ? "negative" : ""}>{value}</strong><small>{note}</small></div>; }
function SectionTitle({ title, note, action }: { title: string; note: string; action?: React.ReactNode }) { return <div className="section-title"><div><h3>{title}</h3><p>{note}</p></div>{action}</div>; }
function Skeleton({ height }: { height: number }) { return <div className="skeleton" style={{ height }} />; }
function Empty({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) { return <div className="empty"><strong>{title}</strong><p>{copy}</p>{action}</div>; }
function Pagination({ page, pages, setPage, label }: { page: number; pages: number; setPage: (page: number) => void; label: string }) {
  return <div className="pagination" aria-label={label}><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">‹</button><span>Page <strong>{page}</strong> of {pages}</span><button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page >= pages} aria-label="Next page">›</button></div>;
}

function shortDay(date: Date) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date); }

function PaceChart({ budget, forecast: f, start, hasExpenses }: { budget: number; forecast: Forecast; start: Date; hasExpenses: boolean }) {
  if (!hasExpenses) return <div className="pace-empty"><div className="pace-empty-line"><i /><i /><i /></div><p>{budget ? `Add an expense and Flow will chart your pace against ${money(budget)}.` : "Set a budget to reveal your spending runway."}</p></div>;
  const n = f.dayCount, last = f.cumulative.length - 1, finish = f.isPast ? f.spent : f.forecast;
  const top = Math.max(budget, f.forecastHigh, f.spent, 1) * 1.12;
  const X = (i: number) => (i + 1) / n * 100, Y = (v: number) => 100 - v / top * 100;
  const actual = `M0 100 ${f.cumulative.map((v, i) => `L${X(i)} ${Y(v)}`).join(" ")}`;
  const ideal = `M0 100 ${f.ideal.map((v, i) => `L${X(i)} ${Y(v)}`).join(" ")}`;
  const x0 = last >= 0 ? X(last) : 0, y0 = last >= 0 ? Y(f.cumulative[last]) : 100;
  const showForecast = !f.isPast && x0 < 100;
  const tone = budget && f.delta < 0 ? "over" : "good";
  const lastDay = new Date(start); lastDay.setDate(start.getDate() + n - 1);
  return <div className="pace-chart-wrap">
    <div className={`pace-chart ${tone}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {[25, 50, 75].map((g) => <line key={g} className="pace-grid" x1="0" x2="100" y1={g} y2={g} />)}
        {budget > 0 && <line className="pace-budget" x1="0" x2="100" y1={Y(budget)} y2={Y(budget)} />}
        {showForecast && <path className="pace-band" d={`M${x0} ${y0} L100 ${Y(f.forecastHigh)} L100 ${Y(f.forecastLow)} Z`} />}
        {budget > 0 && <path className="pace-ideal" d={ideal} />}
        {last >= 0 && <path className="pace-area" d={`${actual} L${x0} 100 Z`} />}
        {last >= 0 && <path className="pace-actual" d={actual} />}
        {showForecast && <path className="pace-forecast" d={`M${x0} ${y0} L100 ${Y(f.forecast)}`} />}
      </svg>
      {budget > 0 && <span className="pace-budget-label" style={{ top: `${Y(budget)}%` }}>Budget {money(budget)}</span>}
      {last >= 0 && <i className="pace-dot now" style={{ left: `${x0}%`, top: `${y0}%` }} />}
      {showForecast && <i className="pace-dot end" style={{ left: "100%", top: `${Y(f.forecast)}%` }} />}
    </div>
    <div className="pace-axis"><span>{shortDay(start)}</span>{f.isCurrent && x0 > 22 && x0 < 78 && <span className="pace-today" style={{ left: `${x0}%` }}>Today</span>}<span>{shortDay(lastDay)}</span></div>
    <div className="pace-legend">
      <div><span className={tone === "over" ? "negative" : "positive"}>● Spent</span><strong>{money(f.spent)}</strong></div>
      {budget > 0 && <div><span className="legend-muted">● Budget pace</span><strong>{money(f.isPast ? budget : f.expectedToday)}</strong></div>}
      <div><span className="legend-accent">● {f.isPast ? "Finished" : "Forecast"}</span><strong>{money(finish)}</strong></div>
    </div>
  </div>;
}

function ActivityChart({ expenses, period, start, budget, dayCount, todayIndex, onRange }: { expenses: Expense[]; period: Period; start: Date; budget: number; dayCount: number; todayIndex: number; onRange: (range: { from: string; to: string }) => void }) {
  const buckets = period === "week"
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ label, from: i, to: i + 1 }))
    : [0, 1, 2, 3, 4].map((i) => ({ label: `W${i + 1}`, from: i * 7, to: Math.min(dayCount, i * 7 + 7) })).filter((b) => b.to > b.from);
  const values = buckets.map(() => 0);
  expenses.forEach((e) => { const d = dateFromKey(e.date); const i = period === "week" ? (d.getDay() + 6) % 7 : Math.min(buckets.length - 1, Math.floor((d.getDate() - 1) / 7)); values[i] += e.amount; });
  const allowed = buckets.map((b) => budget ? budget * (b.to - b.from) / dayCount : 0);
  const max = Math.max(...values, ...allowed, 1) * 1.18;
  return <div className="activity-wrap"><div className="activity-label-title">Activity{budget ? " · ticks mark each slice's share of budget" : ""}</div><div className="activity-chart">{buckets.map((bucket, i) => {
    const state = todayIndex < 0 || bucket.from > todayIndex ? "future" : todayIndex < bucket.to && todayIndex < dayCount - 1 ? "current" : "";
    const over = budget > 0 && values[i] > allowed[i];
    return <button key={bucket.label} className={`activity-col ${state}`} onClick={() => { const from = new Date(start), to = new Date(start); from.setDate(start.getDate() + bucket.from); to.setDate(start.getDate() + bucket.to); onRange({ from: localDateKey(from), to: localDateKey(to) }); document.getElementById("recent-expenses")?.scrollIntoView({ behavior: "smooth" }); }}>
      <span className="activity-value">{values[i] ? money(values[i]) : ""}</span>
      <span className={`activity-bar ${over ? "over" : ""}`} style={{ height: `${Math.max(4, values[i] / max * 100)}%` }} />
      {budget > 0 && <i className="activity-limit" style={{ bottom: `${allowed[i] / max * 100}%` }} />}
      <small>{bucket.label}</small>
    </button>;
  })}</div></div>;
}

function NudgeCard({ nudge }: { nudge: Nudge }) {
  return <div className={`nudge ${nudge.tone} ${nudge.level ?? ""}`} role="status">{nudge.tone === "roast" && <b className="nudge-stamp" aria-hidden="true">{nudge.level === "inferno" ? "COOKED" : "ROASTED"}</b>}<span>{nudge.tone === "roast" ? ROAST_EMOJI[nudge.level ?? "hot"] : "🏆"}</span><div><small>{nudge.label}</small><p>{nudge.line}</p></div></div>;
}

function ExpenseRoastPop({ roast, onClose, onShare }: { roast: ExpenseRoast & { ready: boolean }; onClose: () => void; onShare: () => void }) {
  return <div className={`expense-roast ${roast.level}`} role="alertdialog" aria-labelledby="expense-roast-line">
    <div className="expense-roast-head"><span aria-hidden="true">{ROAST_EMOJI[roast.level]}</span><small>{roast.title}</small><button onClick={onClose} aria-label="Close roast">×</button></div>
    {roast.ready ? <p id="expense-roast-line">{roast.line}</p> : <p id="expense-roast-line" className="expense-roast-cooking">Flow is cooking a roast<i>.</i><i>.</i><i>.</i></p>}
    <div className="expense-roast-actions"><button onClick={onClose}>Haan, galti ho gayi</button>{roast.ready && <button onClick={onShare}>Share</button>}</div>
  </div>;
}

function RoastTakeover({ nudge, spent, budget, forecast, onClose, onShare }: { nudge: Nudge; spent: number; budget: number; forecast: number; onClose: () => void; onShare: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className={`roast-takeover ${nudge.level ?? "hot"}`} role="dialog" aria-modal="true" aria-labelledby="roast-line">
    <div className="roast-burst" aria-hidden="true">{ROAST_EMOJI[nudge.level ?? "hot"]}</div>
    <span className="roast-chip">{nudge.label}</span>
    <p id="roast-line" className="roast-line">{nudge.line}</p>
    <div className="roast-stats">
      <div><small>Spent</small><strong>{money(spent)}</strong></div>
      <div><small>Budget</small><strong>{money(budget)}</strong></div>
      <div><small>Heading to</small><strong>{money(Math.max(spent, forecast))}</strong></div>
    </div>
    <div className="roast-actions">
      <button className="roast-primary" onClick={onClose} autoFocus>Theek hai, sorry 😔</button>
      <button className="roast-secondary" onClick={onShare}>Share roast</button>
    </div>
    <small className="roast-foot">Flow roasts because it cares. Thoda sa.</small>
  </div>;
}

function SmartInsights({ title, note, insights }: { title: string; note: string; insights: Insight[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? insights : insights.slice(0, 3);
  return <section className="section-block"><SectionTitle title={title} note={note} action={insights.length > 3 ? <button onClick={() => setOpen(!open)}>{open ? "Show less" : `+${insights.length - 3} more`}</button> : undefined} />
    <div className="list-card">{shown.map((insight) => <div className="smart-row" key={insight.id}><span className={`row-icon smart-icon ${insight.tone}`}>{insight.icon}</span><span className="row-main"><strong>{insight.title}</strong><small>{insight.detail}</small></span></div>)}</div>
  </section>;
}

function Calendar({ period, anchor, days, selectedDay, onSelect }: { period: Period; anchor: Date; days: DayInfo[]; selectedDay: string; onSelect: (day: string) => void }) {
  const lookup = new Map(days.map((d) => [d.date, d]));
  if (period === "week") {
    return <div className="calendar card-surface"><div className="calendar-head"><strong>{periodTitle(anchor, period)}</strong><CalendarLegend /></div><div className="weekdays">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}</div><div className="calendar-grid week-only">{days.map((d) => <DayButton key={d.date} info={d} selected={selectedDay === d.date} onClick={() => onSelect(d.date)} />)}</div></div>;
  }
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1), count = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate(), blanks = (monthStart.getDay() + 6) % 7;
  const items = Array.from({ length: count }, (_, i) => { const date = new Date(anchor.getFullYear(), anchor.getMonth(), i + 1), key = localDateKey(date); return lookup.get(key) || { date: key, spent: 0, target: 0, status: "none" as const }; });
  return <div className="calendar card-surface"><div className="calendar-head"><strong>{new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(monthStart)}</strong><CalendarLegend /></div><div className="weekdays">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}</div><div className="calendar-grid">{Array.from({ length: blanks }, (_, i) => <span key={`blank-${i}`} />)}{items.map((d) => <DayButton key={d.date} info={d} selected={selectedDay === d.date} onClick={() => onSelect(d.date)} />)}</div></div>;
}
function CalendarLegend() { return <div className="calendar-legend"><span><i className="good" />Below</span><span><i className="equal" />Near</span><span><i className="over" />Over</span></div>; }
function DayButton({ info, selected, onClick }: { info: DayInfo; selected: boolean; onClick: () => void }) { const today = info.date === localDateKey(); return <button className={`calendar-day ${today ? "today" : ""} ${selected ? "selected" : ""}`} onClick={onClick}><strong>{dateFromKey(info.date).getDate()}</strong><i className={info.status} /></button>; }

function CategoryList({ categories, total, active, onSelect }: { categories: [string, number][]; total: number; active: string; onSelect: (s: string) => void }) {
  if (!categories.length) return <div className="card-surface"><Empty title="No categories yet" copy="They’ll appear as you add expenses." /></div>;
  return <div className="card-surface category-list">{categories.slice(0, 7).map(([name, amount]) => <button key={name} className={active === name ? "active" : ""} onClick={() => onSelect(active === name ? "" : name)}><span className="category-dot" /><span><strong>{name}</strong><i><b style={{ width: `${total ? amount / total * 100 : 0}%` }} /></i></span><b>{money(amount)}</b></button>)}</div>;
}

function AccountList({ accounts, total, active, onSelect }: { accounts: [string, number][]; total: number; active: string; onSelect: (account: string) => void }) {
  if (!accounts.length) return <div className="card-surface"><Empty title="No savings accounts yet" copy="Add an opening balance or deposit and Flow will build the account view automatically." /></div>;
  const max = Math.max(...accounts.map(([, amount]) => Math.abs(amount)), 1);
  return <div className="card-surface account-list">{accounts.slice(0, 8).map(([name, amount]) => <button key={name} className={active === name ? "active" : ""} onClick={() => onSelect(active === name ? "" : name)}><span className="account-icon">🏦</span><span><strong>{name}</strong><i><b className={amount < 0 ? "negative-bar" : ""} style={{ width: `${Math.abs(amount) / max * 100}%` }} /></i></span><b className={amount < 0 ? "negative" : ""}>{money(amount)}</b></button>)}{accounts.length > 8 && <div className="account-more">+{accounts.length - 8} more accounts · total {money(total)}</div>}</div>;
}

function Allocation({ investments, total }: { investments: Investment[]; total: number }) {
  const map = new Map<string, number>(); investments.forEach((i) => map.set(i.type, (map.get(i.type) || 0) + i.current)); const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) return <div className="card-surface"><Empty title="No investments yet" copy="Add a holding to see your allocation." /></div>;
  const tones = ["#eea05a", "#d98c49", "#efbd91", "#b97843", "#f4d7bc"]; let at = 0;
  const gradient = rows.map(([, v], i) => { const pct = total ? v / total * 100 : 0, part = `${tones[i]} ${at}% ${at + pct}%`; at += pct; return part; }).join(",");
  return <div className="card-surface allocation"><div className="donut" style={{ background: `conic-gradient(${gradient})` }} /><div className="allocation-list">{rows.map(([name, value], i) => <div key={name}><i style={{ background: tones[i] }} /><span>{name}</span><strong>{total ? Math.round(value / total * 100) : 0}%</strong></div>)}</div></div>;
}
function PortfolioBars({ invested, current }: { invested: number; current: number }) { const max = Math.max(invested, current, 1); return <div className="portfolio-chart"><div><span>Invested</span><div><i style={{ width: `${invested / max * 100}%` }} /></div><strong>{money(invested)}</strong></div><div><span>Current</span><div><i className="current" style={{ width: `${current / max * 100}%` }} /></div><strong>{money(current)}</strong></div></div>; }

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) { return <div className="sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="sheet"><div className="sheet-handle" /><button className="sheet-close" onClick={onClose} aria-label="Close">×</button>{children}</div></div>; }

function ExpenseForm({ draft, setDraft, editing, busy, onSubmit, onDelete, customCategories, quickCategories, onAddCustomCategory }: {
  draft: ExpenseDraft; setDraft: (d: ExpenseDraft) => void; editing: boolean; busy: boolean; onSubmit: (e: FormEvent) => void; onDelete: () => void;
  customCategories: string[]; quickCategories: string[]; onAddCustomCategory: (name: string) => Promise<string | null>;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const customKeys = new Set(customCategories.map((item) => item.toLowerCase()));
  const standardCategories = EXPENSE_CATEGORIES.filter((item) => !customKeys.has(item.toLowerCase()));
  async function createCategory() {
    if (!customName.trim() || addingCustom) return;
    setAddingCustom(true);
    const created = await onAddCustomCategory(customName);
    if (created) { setDraft({ ...draft, category: created }); setCustomName(""); setShowCustom(false); }
    setAddingCustom(false);
  }
  return <form onSubmit={onSubmit}><h2>{editing ? "Edit expense" : "Add expense"}</h2><div className="amount-field"><span>₹</span><input autoFocus type="number" min="0.01" step="0.01" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} placeholder="0" required /></div><div className="quick-cats">{quickCategories.map((cat) => <button type="button" className={draft.category === cat ? "active" : ""} key={cat} onClick={() => setDraft({ ...draft, category: cat })}>{cat}</button>)}</div><div className="form-stack"><label>Category<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} required><option value="">Choose category</option>{customCategories.length > 0 && <optgroup label="Your categories">{customCategories.map((x) => <option key={x}>{x}</option>)}</optgroup>}<optgroup label="Standard categories">{standardCategories.map((x) => <option key={x}>{x}</option>)}</optgroup></select></label><button type="button" className="custom-category-toggle" onClick={() => setShowCustom((value) => !value)}>＋ Add your own category</button>{showCustom && <div className="custom-category-row"><input value={customName} onChange={(e) => setCustomName(e.target.value)} maxLength={80} placeholder="e.g. Inventory purchase" /><button type="button" disabled={addingCustom || !customName.trim()} onClick={() => void createCategory()}>{addingCustom ? "Adding…" : "Add"}</button></div>}<label>Description<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Lunch, packaging, electricity…" /></label><label>Date<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /></label><details><summary>More details</summary><div className="form-stack more-fields"><div className="form-two"><label>Payment<select value={draft.payment} onChange={(e) => setDraft({ ...draft, payment: e.target.value })}><option value="">Not set</option>{PAYMENT_METHODS.map((x) => <option key={x}>{x}</option>)}</select></label><label>Type<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option value="">Not set</option><option>Essential</option><option>Discretionary</option><option>Business</option><option>One-time</option></select></label></div><label>Recurring<select value={draft.recurring} onChange={(e) => setDraft({ ...draft, recurring: e.target.value })}><option value="">No</option><option>Weekly</option><option>Monthly</option><option>Quarterly</option><option>Yearly</option></select></label><label>Note<textarea value={draft.extra} onChange={(e) => setDraft({ ...draft, extra: e.target.value })} placeholder="Optional note" /></label></div></details></div><button className="primary-save" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add expense"}</button>{editing && <button type="button" className="danger-button" onClick={onDelete} disabled={busy}>Delete expense</button>}</form>;
}

function SavingForm({ draft, setDraft, editing, busy, onSubmit, onDelete, accountNames }: { draft: SavingDraft; setDraft: (d: SavingDraft) => void; editing: boolean; busy: boolean; onSubmit: (e: FormEvent) => void; onDelete: () => void; accountNames: string[] }) {
  function changeAction(action: SavingAction) {
    if (action === "opening" || action === "deposit") setDraft({ ...draft, action, fromAccount: "" });
    else if (action === "withdrawal") setDraft({ ...draft, action, toAccount: "" });
    else setDraft({ ...draft, action });
  }
  return <form onSubmit={onSubmit}><h2>{editing ? "Edit savings activity" : "Add savings activity"}</h2><p className="sheet-copy">Transfers between your own accounts do not increase total savings.</p><div className="saving-action-tabs">{(["deposit", "transfer", "withdrawal", "opening"] as SavingAction[]).map((action) => <button type="button" key={action} className={draft.action === action ? "active" : ""} onClick={() => changeAction(action)}>{action === "deposit" ? "Save" : action === "transfer" ? "Transfer" : action === "withdrawal" ? "Use" : "Opening"}</button>)}</div><div className="amount-field"><span>₹</span><input autoFocus type="number" min="0.01" step="0.01" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} placeholder="0" required /></div><div className="form-stack">{(draft.action === "withdrawal" || draft.action === "transfer") && <label>From account<input list="saving-account-names" value={draft.fromAccount} onChange={(e) => setDraft({ ...draft, fromAccount: e.target.value })} placeholder="e.g. HDFC Savings" required /></label>}{(draft.action === "opening" || draft.action === "deposit" || draft.action === "transfer") && <label>To account<input list="saving-account-names" value={draft.toAccount} onChange={(e) => setDraft({ ...draft, toAccount: e.target.value })} placeholder="e.g. Emergency Fund" required /></label>}<datalist id="saving-account-names">{accountNames.map((account) => <option key={account} value={account} />)}</datalist><div className="form-two"><label>Date<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /></label><label>Method<select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}><option value="">Not set</option>{SAVING_METHODS.map((method) => <option key={method}>{method}</option>)}</select></label></div><label>Note<textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Optional note" /></label></div><button className="primary-save" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add activity"}</button>{editing && <button type="button" className="danger-button" onClick={onDelete} disabled={busy}>Delete activity</button>}</form>;
}

function InvestmentForm({ draft, setDraft, editing, busy, onSubmit, onDelete }: { draft: InvestmentDraft; setDraft: (d: InvestmentDraft) => void; editing: boolean; busy: boolean; onSubmit: (e: FormEvent) => void; onDelete: () => void }) {
  return <form onSubmit={onSubmit}><h2>{editing ? "Edit investment" : "Add investment"}</h2><div className="form-stack sheet-form"><label>Name<input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nifty SIP, HDFC FD…" required /></label><label>Type<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} required><option value="">Choose type</option>{INVESTMENT_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label><div className="form-two"><label>Invested<input type="number" min="0.01" step="0.01" value={draft.invested || ""} onChange={(e) => setDraft({ ...draft, invested: Number(e.target.value) })} required /></label><label>Current value<input type="number" min="0.01" step="0.01" value={draft.current || ""} onChange={(e) => setDraft({ ...draft, current: Number(e.target.value) })} required /></label></div><label>Date<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /></label><details><summary>More details</summary><div className="form-stack more-fields"><div className="form-two"><label>Frequency<select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}><option value="">Not set</option><option>Monthly</option><option>Quarterly</option><option>Yearly</option><option>One-time</option></select></label><label>Rate / return<input type="number" step="0.01" value={draft.rate ?? ""} onChange={(e) => setDraft({ ...draft, rate: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Optional" /></label></div><label>Platform / bank<input value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })} placeholder="Optional" /></label><label>Maturity<input type="date" value={draft.maturity} onChange={(e) => setDraft({ ...draft, maturity: e.target.value })} /></label><label>Note<textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Optional note" /></label></div></details></div><button className="primary-save" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add investment"}</button>{editing && <button type="button" className="danger-button" onClick={onDelete} disabled={busy}>Delete investment</button>}</form>;
}
function BudgetForm({ period, value, setValue, busy, onSubmit }: { period: Period; value: number; setValue: (v: number) => void; busy: boolean; onSubmit: (e: FormEvent) => void }) { return <form onSubmit={onSubmit}><h2>Set budget</h2><p className="sheet-copy">{period === "month" ? "Monthly" : "Weekly"} budget</p><div className="amount-field"><span>₹</span><input autoFocus type="number" min="1" step="1" value={value || ""} onChange={(e) => setValue(Number(e.target.value))} placeholder="0" required /></div><button className="primary-save" disabled={busy}>{busy ? "Saving…" : "Save budget"}</button></form>; }
function DaySheet({ day, days, expenses, budget, onView }: { day: string; days: DayInfo[]; expenses: Expense[]; budget: number; onView: () => void }) { const info = days.find((d) => d.date === day), count = expenses.filter((e) => e.date === day).length; return <div><h2>{day ? fullDate(day) : "Day"}</h2><div className="day-big">{money(info?.spent || 0)}</div><div className={`status-pill ${info?.status || "none"}`}>{!info?.spent ? "No spending recorded" : !budget ? "Budget not set" : info.status === "good" ? "Below daily allowance" : info.status === "equal" ? "Near daily allowance" : "Over daily allowance"}</div><div className="day-lines"><div><span>Daily allowance</span><strong>{info?.target ? money(info.target) : "—"}</strong></div><div><span>Transactions</span><strong>{count}</strong></div></div><button className="primary-save" onClick={onView}>View expenses</button></div>; }
