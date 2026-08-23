"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Period = "week" | "month";
type Page = "expenses" | "investments";
type User = { id: string; name: string; email: string };
type Expense = {
  id: string; amount: number; category: string; date: string; name: string; payment: string;
  type: string; recurring: string; extra: string;
};
type Investment = {
  id: string; name: string; type: string; invested: number; current: number; date: string;
  frequency: string; rate: number | null; platform: string; maturity: string; note: string;
};
type DayInfo = { date: string; spent: number; target: number; status: "none" | "good" | "equal" | "over" };
type PaceSummary = {
  days: DayInfo[]; spent: number; remaining: number; expected: number; delta: number; recorded: DayInfo[];
  good: number; daily: number; projection: number; dayCount: number; isCurrent: boolean;
};

type ExpenseDraft = Omit<Expense, "id">;
type InvestmentDraft = Omit<Investment, "id">;

const EXPENSE_CATEGORIES = [
  "Food & Dining", "Groceries", "Travel & Transport", "Bills & Utilities", "Rent", "Shopping",
  "Entertainment", "Subscriptions", "Health", "Education", "EMI / Loan", "Insurance",
  "Personal Care", "Gifts", "Taxes", "Other",
];
const INVESTMENT_TYPES = ["SIP", "Mutual Fund", "Stocks", "FD", "RD", "PPF", "EPF", "NPS", "Bonds", "Gold", "REIT", "Other"];

const EMPTY_EXPENSE: ExpenseDraft = { amount: 0, category: "", date: "", name: "", payment: "", type: "", recurring: "", extra: "" };
const EMPTY_INVESTMENT: InvestmentDraft = { name: "", type: "", invested: 0, current: 0, date: "", frequency: "", rate: null, platform: "", maturity: "", note: "" };

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
  if (c.includes("personal")) return "✨"; if (c.includes("gift")) return "🎁"; if (c.includes("tax")) return "🧾"; return "💸";
}
function investmentEmoji(type: string) {
  const t = type.toLowerCase();
  if (t.includes("sip") || t.includes("mutual")) return "📊"; if (t.includes("stock")) return "📈"; if (t === "fd" || t === "rd") return "🏦";
  if (t.includes("gold")) return "🪙"; if (t.includes("bond")) return "📜"; if (t.includes("ppf") || t.includes("epf") || t.includes("nps")) return "🌱";
  if (t.includes("reit")) return "🏢"; return "💰";
}
function greeting(name?: string) {
  const now = new Date(), hour = now.getHours();
  const word = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = name?.trim().split(/\s+/)[0];
  return `${word}${firstName ? `, ${firstName}` : ""} · ${new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(now)}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.assign("/login"); throw new Error("Please sign in again"); }
  if (!response.ok) throw new Error((data as { error?: string }).error || "Something went wrong");
  return data as T;
}

export default function FlowDashboard({ user }: { user: User }) {
  const [page, setPage] = useState<Page>("expenses");
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [budget, setBudget] = useState(0);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [loadingInvestments, setLoadingInvestments] = useState(true);
  const [sheet, setSheet] = useState<"expense" | "investment" | "budget" | "day" | "profile" | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>({ ...EMPTY_EXPENSE, date: localDateKey() });
  const [investmentDraft, setInvestmentDraft] = useState<InvestmentDraft>({ ...EMPTY_INVESTMENT, date: localDateKey() });
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingInvestmentId, setEditingInvestmentId] = useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [expenseSearch, setExpenseSearch] = useState("");
  const [investmentSearch, setInvestmentSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [rangeFilter, setRangeFilter] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useMemo(() => startOfPeriod(anchor, period), [anchor, period]);
  const end = useMemo(() => endOfPeriod(anchor, period), [anchor, period]);
  const startKey = localDateKey(start), endKey = localDateKey(end);

  const notify = useCallback((message: string) => {
    setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }, []);

  const loadExpenses = useCallback(async () => {
    setLoadingExpenses(true);
    try {
      const [expenseResult, budgetResult] = await Promise.all([
        api<{ expenses: Expense[] }>(`/api/expenses?from=${startKey}&to=${endKey}`),
        api<{ budget: { amount: number } | null }>(`/api/budgets?periodType=${period}&periodStart=${startKey}`),
      ]);
      setExpenses(expenseResult.expenses); setBudget(budgetResult.budget?.amount ?? 0);
    } catch (e) { notify(e instanceof Error ? e.message : "Could not load expenses"); }
    finally { setLoadingExpenses(false); }
  }, [startKey, endKey, period, notify]);

  const loadInvestments = useCallback(async () => {
    setLoadingInvestments(true);
    try { setInvestments((await api<{ investments: Investment[] }>("/api/investments")).investments); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not load investments"); }
    finally { setLoadingInvestments(false); }
  }, [notify]);

  useEffect(() => { void loadExpenses(); setSelectedDay(""); setCategoryFilter(""); setRangeFilter(null); }, [loadExpenses]);
  useEffect(() => { void loadInvestments(); }, [loadInvestments]);

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

  const categories = useMemo(() => {
    const map = new Map<string, number>(); expenses.forEach((e) => map.set(e.category, (map.get(e.category) || 0) + e.amount));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    const query = expenseSearch.trim().toLowerCase();
    return [...expenses].filter((e) => {
      if (selectedDay && e.date !== selectedDay) return false;
      if (categoryFilter && e.category !== categoryFilter) return false;
      if (rangeFilter && !(e.date >= rangeFilter.from && e.date < rangeFilter.to)) return false;
      return !query || [e.category, e.name, e.payment, e.extra].some((v) => v.toLowerCase().includes(query));
    }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [expenses, expenseSearch, selectedDay, categoryFilter, rangeFilter]);

  const filteredInvestments = useMemo(() => {
    const query = investmentSearch.trim().toLowerCase();
    return [...investments].filter((i) => !query || [i.name, i.type, i.platform, i.frequency].some((v) => v.toLowerCase().includes(query))).sort((a, b) => b.date.localeCompare(a.date));
  }, [investments, investmentSearch]);

  const investmentTotals = useMemo(() => {
    const invested = investments.reduce((a, i) => a + i.invested, 0), current = investments.reduce((a, i) => a + i.current, 0);
    return { invested, current, gain: current - invested };
  }, [investments]);

  function shiftPeriod(by: number) {
    setAnchor((prev) => {
      const next = new Date(prev);
      if (period === "month") next.setMonth(next.getMonth() + by, 1); else next.setDate(next.getDate() + by * 7);
      return next;
    });
  }
  function clearFilters() { setSelectedDay(""); setCategoryFilter(""); setRangeFilter(null); setExpenseSearch(""); }
  function openNew(kind: "expense" | "investment") {
    if (kind === "expense") { setEditingExpenseId(null); setExpenseDraft({ ...EMPTY_EXPENSE, date: localDateKey(new Date(Math.max(start.getTime(), Math.min(Date.now(), end.getTime() - 1)))) }); }
    else { setEditingInvestmentId(null); setInvestmentDraft({ ...EMPTY_INVESTMENT, date: localDateKey() }); }
    setSheet(kind);
  }
  function editExpense(expense: Expense) { setEditingExpenseId(expense.id); setExpenseDraft({ ...expense }); setSheet("expense"); }
  function editInvestment(investment: Investment) { setEditingInvestmentId(investment.id); setInvestmentDraft({ ...investment }); setSheet("investment"); }

  async function saveExpense(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const url = editingExpenseId ? `/api/expenses/${editingExpenseId}` : "/api/expenses";
      const method = editingExpenseId ? "PATCH" : "POST";
      await api(url, { method, body: JSON.stringify(expenseDraft) });
      await loadExpenses(); setSheet(null); notify(editingExpenseId ? "Expense updated" : "Expense added");
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
      await loadInvestments(); setSheet(null); notify(editingInvestmentId ? "Investment updated" : "Investment added");
    } catch (e) { notify(e instanceof Error ? e.message : "Could not save investment"); }
    finally { setBusy(false); }
  }
  async function deleteInvestment() {
    if (!editingInvestmentId || busy) return; setBusy(true);
    try { await api(`/api/investments/${editingInvestmentId}`, { method: "DELETE" }); await loadInvestments(); setSheet(null); notify("Investment deleted"); }
    catch (e) { notify(e instanceof Error ? e.message : "Could not delete investment"); }
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

  const insight = useMemo(() => {
    if (!budget && !expenses.length) return "Set a budget or add an expense and Flow will show one useful action here.";
    if (!budget) return `You’ve spent ${money(pace.spent)} this ${period}. Set a budget to unlock pace and daily allowance.`;
    if (!pace.isCurrent) return pace.remaining >= 0 ? `You finished this period ${money(pace.remaining)} under budget.` : `This period ended ${money(Math.abs(pace.remaining))} over budget.`;
    if (pace.remaining < 0) return `You’re ${money(Math.abs(pace.remaining))} over budget. Keep the rest of this period intentionally light.`;
    if (expenses.length && pace.projection > budget) return `At this pace you may finish about ${money(pace.projection - budget)} over budget. Aim for about ${money(pace.daily)} or less today.`;
    if (expenses.length) return `You can spend about ${money(pace.daily)} per day from here and stay within budget.`;
    return `Your current daily allowance is ${money(pace.daily)}. It will adjust automatically as you spend.`;
  }, [budget, expenses.length, pace, period]);

  return (
    <div className="flow-app">
      <aside className="desktop-rail" aria-label="Main navigation">
        <div className="rail-brand">Flow</div>
        <button className={`rail-tab ${page === "expenses" ? "active" : ""}`} onClick={() => setPage("expenses")}><span>🧾</span>Expenses</button>
        <button className={`rail-tab ${page === "investments" ? "active" : ""}`} onClick={() => setPage("investments")}><span>📈</span>Investments</button>
        <button className="rail-add" onClick={() => openNew(page === "expenses" ? "expense" : "investment")}>＋ Add {page === "expenses" ? "expense" : "investment"}</button>
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
            <p className="greeting"><strong>{greeting(user.name).split(" · ")[0]}</strong> · {greeting(user.name).split(" · ")[1]}</p>
            <p className="kicker">{page === "expenses" ? "Personal money" : "Long-term money"}</p>
            <h1>{page === "expenses" ? "Expenses" : "Investments"}</h1>
            <div className="period-controls">
              <div className="period-nav"><button onClick={() => shiftPeriod(-1)} aria-label="Previous period">‹</button><strong>{periodTitle(anchor, period)}</strong><button onClick={() => shiftPeriod(1)} aria-label="Next period">›</button></div>
              <div className="period-right"><button className="today-button" onClick={() => setAnchor(new Date())}>Today</button><div className="segmented"><button className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>Week</button><button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>Month</button></div></div>
            </div>
          </section>

          {page === "expenses" ? (
            <ExpensesView loading={loadingExpenses} budget={budget} pace={pace} insight={insight} expenses={expenses} categories={categories}
              filteredExpenses={filteredExpenses} selectedDay={selectedDay} period={period} anchor={anchor} start={start}
              setSheet={setSheet} setBudgetDraft={setBudgetDraft} onEdit={editExpense} onSelectDay={(day) => { setSelectedDay(day); setSheet("day"); }}
              categoryFilter={categoryFilter} onCategory={(cat) => { setCategoryFilter(cat); setSelectedDay(""); setRangeFilter(null); }}
              expenseSearch={expenseSearch} setExpenseSearch={setExpenseSearch} onRange={(range) => { setRangeFilter(range); setSelectedDay(""); setCategoryFilter(""); }}
              clearFilters={clearFilters} onAdd={() => openNew("expense")} />
          ) : (
            <InvestmentsView loading={loadingInvestments} investments={filteredInvestments} allInvestments={investments} totals={investmentTotals}
              search={investmentSearch} setSearch={setInvestmentSearch} onEdit={editInvestment} onAdd={() => openNew("investment")} />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        <button className={page === "expenses" ? "active" : ""} onClick={() => setPage("expenses")}><span>🧾</span><small>Expenses</small></button>
        <button className="mobile-fab" onClick={() => openNew(page === "expenses" ? "expense" : "investment")} aria-label={`Add ${page === "expenses" ? "expense" : "investment"}`}>＋</button>
        <button className={page === "investments" ? "active" : ""} onClick={() => setPage("investments")}><span>📈</span><small>Investments</small></button>
      </nav>

      {sheet && <Sheet onClose={() => setSheet(null)}>
        {sheet === "expense" && <ExpenseForm draft={expenseDraft} setDraft={setExpenseDraft} editing={Boolean(editingExpenseId)} busy={busy} onSubmit={saveExpense} onDelete={deleteExpense} />}
        {sheet === "investment" && <InvestmentForm draft={investmentDraft} setDraft={setInvestmentDraft} editing={Boolean(editingInvestmentId)} busy={busy} onSubmit={saveInvestment} onDelete={deleteInvestment} />}
        {sheet === "budget" && <BudgetForm period={period} value={budgetDraft} setValue={setBudgetDraft} busy={busy} onSubmit={saveBudget} />}
        {sheet === "day" && <DaySheet day={selectedDay} days={pace.days} expenses={expenses} budget={budget} onView={() => setSheet(null)} />}
        {sheet === "profile" && <ProfileSheet user={user} busy={busy} onSignOut={signOut} />}
      </Sheet>}
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </div>
  );
}

function ExpensesView(props: {
  loading: boolean; budget: number; pace: PaceSummary; insight: string; expenses: Expense[]; categories: [string, number][];
  filteredExpenses: Expense[]; selectedDay: string; period: Period; anchor: Date; start: Date;
  setSheet: (s: "budget") => void; setBudgetDraft: (v: number) => void; onEdit: (e: Expense) => void; onSelectDay: (d: string) => void;
  categoryFilter: string; onCategory: (cat: string) => void; expenseSearch: string; setExpenseSearch: (s: string) => void;
  onRange: (range: { from: string; to: string }) => void; clearFilters: () => void; onAdd: () => void;
}) {
  const { loading, budget, pace, insight, expenses, categories, filteredExpenses, selectedDay, period, anchor, start, setSheet, setBudgetDraft, onEdit, onSelectDay, categoryFilter, onCategory, expenseSearch, setExpenseSearch, onRange, clearFilters, onAdd } = props;
  const usedPct = budget ? Math.max(0, pace.spent / budget * 100) : 0;
  const anyFilter = Boolean(selectedDay || categoryFilter || expenseSearch);
  return <div className="page-enter">
    <div className="summary-grid">
      <section className="budget-hero card-surface">
        <p>{period === "month" ? "Monthly" : "Weekly"} budget</p>
        <h2 className={budget && pace.remaining < 0 ? "negative" : ""}>{budget ? money(Math.abs(pace.remaining)) : money(pace.spent)}</h2>
        <div className="hero-copy">{budget ? pace.remaining >= 0 ? "left this period" : "over budget" : expenses.length ? "spent · set a budget to see pace" : "Set a budget to start tracking your pace."}</div>
        <div className="budget-track"><div className={usedPct > 100 ? "over" : ""} style={{ width: `${Math.min(100, usedPct)}%` }} /></div>
        <div className="budget-footer"><span>{budget ? `${money(pace.spent)} of ${money(budget)} · ${Math.round(usedPct)}% used` : "No budget yet"}</span><button onClick={() => { setBudgetDraft(budget); setSheet("budget"); }}>{budget ? "Edit budget" : "Set budget"}</button></div>
      </section>
      <div className="stat-grid">
        <Stat label="Today's allowance" value={budget ? money(pace.daily) : "—"} note={budget ? "Based on what remains" : "Set a budget first"} />
        <Stat label="Budget pace" value={budget ? money(Math.abs(pace.delta)) : "—"} note={budget ? pace.delta >= 0 ? "ahead of budget pace" : "behind budget pace" : "Expected vs actual"} tone={budget ? pace.delta >= 0 ? "good" : "bad" : undefined} />
        <Stat label="Days on budget" value={pace.recorded.length ? `${pace.good}/${pace.recorded.length}` : "0"} note={pace.recorded.length ? "recorded days below allowance" : "No recorded days yet"} />
      </div>
    </div>
    <div className="insight"><span>i</span><p>{insight}</p></div>
    <section className="section-block">
      <SectionTitle title="Spending pace" note="Green shows your actual pace. Red marks the budget alert pace." />
      <div className="card-surface chart-surface">
        {loading ? <Skeleton height={180} /> : <PaceGraphic budget={budget} spent={pace.spent} expected={pace.expected} />}
        {!!expenses.length && <ActivityChart expenses={expenses} period={period} start={start} onRange={onRange} />}
      </div>
    </section>
    <div className="two-column">
      <section className="section-block"><SectionTitle title="Calendar" note="Tap a day to see how it went." /><Calendar period={period} anchor={anchor} days={pace.days} selectedDay={selectedDay} onSelect={onSelectDay} /></section>
      <section className="section-block"><SectionTitle title="Categories" note="Where your money went." /><CategoryList categories={categories} total={pace.spent} active={categoryFilter} onSelect={onCategory} /></section>
    </div>
    <section className="section-block recent" id="recent-expenses"><SectionTitle title="Recent expenses" note={expenses.length ? `${filteredExpenses.length} of ${expenses.length} shown` : "No expenses yet."} action={anyFilter ? <button onClick={clearFilters}>Clear filter</button> : undefined} />
      <div className="list-card">
        {expenses.length >= 4 && <div className="search-row"><input value={expenseSearch} onChange={(e) => setExpenseSearch(e.target.value)} placeholder="Search expenses" /></div>}
        {filteredExpenses.length ? filteredExpenses.map((e) => <button className="money-row" key={e.id} onClick={() => onEdit(e)}><span className="row-icon">{expenseEmoji(e.category)}</span><span className="row-main"><strong>{e.category}</strong><small>{longDate(e.date)}</small></span><b>{money(e.amount)}</b></button>) : <Empty title={expenses.length ? "Nothing matches this filter" : "Your spending starts here"} copy={expenses.length ? "Clear the filter to see your expenses again." : "Add your first expense and the dashboard builds itself."} action={!expenses.length ? <button className="empty-action" onClick={onAdd}>＋ Add first expense</button> : undefined} />}
      </div>
    </section>
  </div>;
}

function InvestmentsView({ loading, investments, allInvestments, totals, search, setSearch, onEdit, onAdd }: { loading: boolean; investments: Investment[]; allInvestments: Investment[]; totals: { invested: number; current: number; gain: number }; search: string; setSearch: (s: string) => void; onEdit: (i: Investment) => void; onAdd: () => void }) {
  return <div className="page-enter">
    <section className="investment-hero card-surface"><div><p>Current value</p><h2>{money(totals.current)}</h2></div><div className="investment-mini"><Stat label="Invested" value={money(totals.invested)} note="Total principal" /><Stat label="Gain / loss" value={`${totals.gain >= 0 ? "+" : ""}${money(totals.gain)}`} note="Current vs invested" tone={totals.gain >= 0 ? "good" : "bad"} /></div></section>
    <div className="two-column investment-columns">
      <section className="section-block"><SectionTitle title="Allocation" note="Simple, not a trading dashboard." /><Allocation investments={allInvestments} total={totals.current} /></section>
      <section className="section-block"><SectionTitle title="Portfolio position" note="Invested vs current value." /><div className="card-surface portfolio-bars">{loading ? <Skeleton height={160} /> : <PortfolioBars invested={totals.invested} current={totals.current} />}</div></section>
    </div>
    <section className="section-block"><SectionTitle title="Your investments" note={allInvestments.length ? `${investments.length} of ${allInvestments.length} shown` : "No holdings yet."} />
      <div className="list-card">{allInvestments.length >= 4 && <div className="search-row"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search investments" /></div>}
        {investments.length ? investments.map((i) => { const gain = i.current - i.invested; return <button className="money-row" key={i.id} onClick={() => onEdit(i)}><span className="row-icon">{investmentEmoji(i.type)}</span><span className="row-main"><strong>{i.name}</strong><small>{i.type}{i.platform ? ` · ${i.platform}` : ""}</small></span><span className="row-values"><b>{money(i.current)}</b><small className={gain >= 0 ? "positive" : "negative"}>{gain >= 0 ? "+" : ""}{money(gain)}</small></span></button>; }) : <Empty title="Start your portfolio" copy="Track SIPs, FDs, stocks and more in one calm view." action={<button className="empty-action" onClick={onAdd}>＋ Add first investment</button>} />}
      </div>
    </section>
  </div>;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "bad" }) { return <div className="stat-card"><span>{label}</span><strong className={tone === "good" ? "positive" : tone === "bad" ? "negative" : ""}>{value}</strong><small>{note}</small></div>; }
function SectionTitle({ title, note, action }: { title: string; note: string; action?: React.ReactNode }) { return <div className="section-title"><div><h3>{title}</h3><p>{note}</p></div>{action}</div>; }
function Skeleton({ height }: { height: number }) { return <div className="skeleton" style={{ height }} />; }
function Empty({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) { return <div className="empty"><strong>{title}</strong><p>{copy}</p>{action}</div>; }

function PaceGraphic({ budget, spent, expected }: { budget: number; spent: number; expected: number }) {
  if (!budget) return <div className="pace-empty"><div className="pace-empty-line"><i /><i /><i /></div><p>Set a budget to reveal your spending runway.</p></div>;
  const actual = Math.min(100, spent / budget * 100), alert = Math.min(100, expected / budget * 100);
  return <div className="runway-wrap"><div className="runway-scale"><span>₹0</span><span>{money(budget)}</span></div><div className="runway"><div className="runway-track" /><div className="runway-fill" style={{ width: `${actual}%` }} /><i className="runway-marker actual" style={{ left: `${actual}%` }} /><i className="runway-marker alert" style={{ left: `${alert}%` }} /></div><div className="runway-labels"><div><span className="positive">● Actual</span><strong>{money(spent)}</strong></div><div><span className="negative">● Alert pace</span><strong>{money(expected)}</strong></div></div></div>;
}

function ActivityChart({ expenses, period, start, onRange }: { expenses: Expense[]; period: Period; start: Date; onRange: (range: { from: string; to: string }) => void }) {
  const labels = period === "week" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["W1", "W2", "W3", "W4", "W5"];
  const values = Array(labels.length).fill(0) as number[];
  expenses.forEach((e) => { const d = dateFromKey(e.date); const i = period === "week" ? (d.getDay() + 6) % 7 : Math.min(4, Math.floor((d.getDate() - 1) / 7)); values[i] += e.amount; });
  const max = Math.max(...values, 1);
  return <div className="activity-wrap"><div className="activity-label-title">Activity</div><div className="activity-chart">{labels.map((label, i) => <button key={label} className="activity-col" onClick={() => { const from = new Date(start), to = new Date(start); if (period === "week") { from.setDate(start.getDate() + i); to.setDate(from.getDate() + 1); } else { from.setDate(1 + i * 7); const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 1); to.setDate(1 + (i + 1) * 7); if (to > monthEnd) to.setFullYear(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate()); } onRange({ from: localDateKey(from), to: localDateKey(to) }); document.getElementById("recent-expenses")?.scrollIntoView({ behavior: "smooth" }); }}><span className="activity-value">{values[i] ? money(values[i]) : ""}</span><span className="activity-bar" style={{ height: `${Math.max(4, values[i] / max * 100)}%` }} /><small>{label}</small></button>)}</div></div>;
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

function Allocation({ investments, total }: { investments: Investment[]; total: number }) {
  const map = new Map<string, number>(); investments.forEach((i) => map.set(i.type, (map.get(i.type) || 0) + i.current)); const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) return <div className="card-surface"><Empty title="No investments yet" copy="Add a holding to see your allocation." /></div>;
  const tones = ["#eea05a", "#d98c49", "#efbd91", "#b97843", "#f4d7bc"]; let at = 0;
  const gradient = rows.map(([, v], i) => { const pct = total ? v / total * 100 : 0, part = `${tones[i]} ${at}% ${at + pct}%`; at += pct; return part; }).join(",");
  return <div className="card-surface allocation"><div className="donut" style={{ background: `conic-gradient(${gradient})` }} /><div className="allocation-list">{rows.map(([name, value], i) => <div key={name}><i style={{ background: tones[i] }} /><span>{name}</span><strong>{total ? Math.round(value / total * 100) : 0}%</strong></div>)}</div></div>;
}
function PortfolioBars({ invested, current }: { invested: number; current: number }) { const max = Math.max(invested, current, 1); return <div className="portfolio-chart"><div><span>Invested</span><div><i style={{ width: `${invested / max * 100}%` }} /></div><strong>{money(invested)}</strong></div><div><span>Current</span><div><i className="current" style={{ width: `${current / max * 100}%` }} /></div><strong>{money(current)}</strong></div></div>; }

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) { return <div className="sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="sheet"><div className="sheet-handle" /><button className="sheet-close" onClick={onClose} aria-label="Close">×</button>{children}</div></div>; }

function ExpenseForm({ draft, setDraft, editing, busy, onSubmit, onDelete }: { draft: ExpenseDraft; setDraft: (d: ExpenseDraft) => void; editing: boolean; busy: boolean; onSubmit: (e: FormEvent) => void; onDelete: () => void }) {
  return <form onSubmit={onSubmit}><h2>{editing ? "Edit expense" : "Add expense"}</h2><div className="amount-field"><span>₹</span><input autoFocus type="number" min="0.01" step="0.01" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} placeholder="0" required /></div><div className="quick-cats">{["Food & Dining", "Groceries", "Travel & Transport", "Bills & Utilities", "Shopping"].map((cat) => <button type="button" className={draft.category === cat ? "active" : ""} key={cat} onClick={() => setDraft({ ...draft, category: cat })}>{cat.replace(" & Dining", "").replace(" & Transport", "").replace(" & Utilities", "")}</button>)}</div><div className="form-stack"><label>Category<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} required><option value="">Choose category</option>{EXPENSE_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></label><label>Description<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Lunch, Uber, electricity…" /></label><label>Date<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /></label><details><summary>More details</summary><div className="form-stack more-fields"><div className="form-two"><label>Payment<select value={draft.payment} onChange={(e) => setDraft({ ...draft, payment: e.target.value })}><option value="">Not set</option>{["UPI", "Cash", "Credit Card", "Debit Card", "Bank Transfer", "Wallet", "Auto Debit"].map((x) => <option key={x}>{x}</option>)}</select></label><label>Type<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option value="">Not set</option><option>Essential</option><option>Discretionary</option><option>One-time</option></select></label></div><label>Recurring<select value={draft.recurring} onChange={(e) => setDraft({ ...draft, recurring: e.target.value })}><option value="">No</option><option>Weekly</option><option>Monthly</option><option>Yearly</option></select></label><label>Note<textarea value={draft.extra} onChange={(e) => setDraft({ ...draft, extra: e.target.value })} placeholder="Optional note" /></label></div></details></div><button className="primary-save" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add expense"}</button>{editing && <button type="button" className="danger-button" onClick={onDelete} disabled={busy}>Delete expense</button>}</form>;
}
function InvestmentForm({ draft, setDraft, editing, busy, onSubmit, onDelete }: { draft: InvestmentDraft; setDraft: (d: InvestmentDraft) => void; editing: boolean; busy: boolean; onSubmit: (e: FormEvent) => void; onDelete: () => void }) {
  return <form onSubmit={onSubmit}><h2>{editing ? "Edit investment" : "Add investment"}</h2><div className="form-stack sheet-form"><label>Name<input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nifty SIP, HDFC FD…" required /></label><label>Type<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} required><option value="">Choose type</option>{INVESTMENT_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label><div className="form-two"><label>Invested<input type="number" min="0.01" step="0.01" value={draft.invested || ""} onChange={(e) => setDraft({ ...draft, invested: Number(e.target.value) })} required /></label><label>Current value<input type="number" min="0.01" step="0.01" value={draft.current || ""} onChange={(e) => setDraft({ ...draft, current: Number(e.target.value) })} required /></label></div><label>Date<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} required /></label><details><summary>More details</summary><div className="form-stack more-fields"><div className="form-two"><label>Frequency<select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}><option value="">Not set</option><option>Monthly</option><option>Quarterly</option><option>Yearly</option><option>One-time</option></select></label><label>Rate / return<input type="number" step="0.01" value={draft.rate ?? ""} onChange={(e) => setDraft({ ...draft, rate: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Optional" /></label></div><label>Platform / bank<input value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })} placeholder="Optional" /></label><label>Maturity<input type="date" value={draft.maturity} onChange={(e) => setDraft({ ...draft, maturity: e.target.value })} /></label><label>Note<textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Optional note" /></label></div></details></div><button className="primary-save" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add investment"}</button>{editing && <button type="button" className="danger-button" onClick={onDelete} disabled={busy}>Delete investment</button>}</form>;
}
function BudgetForm({ period, value, setValue, busy, onSubmit }: { period: Period; value: number; setValue: (v: number) => void; busy: boolean; onSubmit: (e: FormEvent) => void }) { return <form onSubmit={onSubmit}><h2>Set budget</h2><p className="sheet-copy">{period === "month" ? "Monthly" : "Weekly"} budget</p><div className="amount-field"><span>₹</span><input autoFocus type="number" min="1" step="1" value={value || ""} onChange={(e) => setValue(Number(e.target.value))} placeholder="0" required /></div><button className="primary-save" disabled={busy}>{busy ? "Saving…" : "Save budget"}</button></form>; }
function DaySheet({ day, days, expenses, budget, onView }: { day: string; days: DayInfo[]; expenses: Expense[]; budget: number; onView: () => void }) { const info = days.find((d) => d.date === day), count = expenses.filter((e) => e.date === day).length; return <div><h2>{day ? fullDate(day) : "Day"}</h2><div className="day-big">{money(info?.spent || 0)}</div><div className={`status-pill ${info?.status || "none"}`}>{!info?.spent ? "No spending recorded" : !budget ? "Budget not set" : info.status === "good" ? "Below daily allowance" : info.status === "equal" ? "Near daily allowance" : "Over daily allowance"}</div><div className="day-lines"><div><span>Daily allowance</span><strong>{info?.target ? money(info.target) : "—"}</strong></div><div><span>Transactions</span><strong>{count}</strong></div></div><button className="primary-save" onClick={onView}>View expenses</button></div>; }
function ProfileSheet({ user, busy, onSignOut }: { user: User; busy: boolean; onSignOut: () => void }) { return <div><h2>Account</h2><div className="profile-card"><span className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div><a className="profile-export" href="/api/export">⇩ Export all data as CSV</a><button className="danger-button profile-signout" onClick={onSignOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button></div>; }
