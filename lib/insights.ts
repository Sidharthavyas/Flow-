// Forecasting and insight engine for the dashboard. Pure functions only: no React, no fetches.

export type Period = "week" | "month";
export type InsightTone = "good" | "warn" | "bad" | "info";
export type Insight = { id: string; tone: InsightTone; icon: string; title: string; detail: string; score: number };
export type PaceStatus = "none" | "comfortable" | "on-track" | "tight" | "overshoot" | "over";

type ExpenseInput = { amount: number; category: string; date: string; name: string; type: string; recurring: string };
type SavingInput = { action: "opening" | "deposit" | "transfer" | "withdrawal"; amount: number; date: string };
type InvestmentInput = { name: string; type: string; invested: number; current: number; date: string; rate: number | null; maturity: string };
type DayInput = { date: string; spent: number; status: "none" | "good" | "equal" | "over" };

export type Forecast = {
  dayCount: number; todayIndex: number; elapsed: number; isCurrent: boolean; isPast: boolean;
  daily: number[]; variableDaily: number[]; cumulative: number[]; ideal: number[];
  spent: number; spentToday: number; fixedSpent: number; lumps: ExpenseInput[];
  dailyRate: number; upcoming: { label: string; amount: number }[]; upcomingTotal: number;
  forecast: number; forecastLow: number; forecastHigh: number;
  expectedToday: number; delta: number; safeToday: number; leftToday: number;
  runOutDate: string | null; status: PaceStatus;
};

const DAY = 86_400_000;
const INFLATION = 0.06;
// Spends that land in chunks (rent, EMI, bills) rather than day by day.
const FIXED_CATEGORIES = new Set(["rent", "emi / loan", "insurance", "taxes", "bills & utilities", "subscriptions", "education"]);

export function keyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseKey(key: string) { return new Date(`${key}T00:00:00`); }
function indexOf(key: string, start: Date) { return Math.round((parseKey(key).getTime() - start.getTime()) / DAY); }
function addDays(date: Date, days: number) { const x = new Date(date); x.setDate(x.getDate() + days); return x; }
function sum(values: number[]) { return values.reduce((a, v) => a + v, 0); }
function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdDev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = sum(values) / values.length;
  return Math.sqrt(sum(values.map((v) => (v - mean) ** 2)) / (values.length - 1));
}
function money(value: number) { return `₹${Math.round(value || 0).toLocaleString("en-IN")}`; }
function shortDate(key: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(parseKey(key)); }
function monthYear(key: string) { return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(parseKey(key)); }
function pct(value: number) { return `${Math.round(value * 100)}%`; }
function roundTo(value: number, step: number) { return Math.max(step, Math.round(value / step) * step); }
function signature(e: ExpenseInput) { return `${e.category.toLowerCase()}|${e.name.trim().toLowerCase()}`; }

export function isFixedExpense(e: ExpenseInput) {
  return Boolean(e.recurring) || e.type === "One-time" || FIXED_CATEGORIES.has(e.category.toLowerCase());
}

export function previousPeriodStart(start: Date, period: Period) {
  return period === "month" ? new Date(start.getFullYear(), start.getMonth() - 1, 1) : addDays(start, -7);
}

/**
 * Forecasts where spending lands by period end.
 * - Fixed and one-off spends (rent, EMI, a single huge purchase) are kept out of the daily run-rate.
 * - The run-rate blends the plain average with an exponentially weighted one (recent days count more),
 *   then shrinks towards last period's daily average while there are only a few days of data.
 * - Recurring bills seen last period but not yet this period are reserved as "upcoming".
 */
export function computeForecast({ expenses, prevExpenses, budget, start, end, period, now = new Date() }: {
  expenses: ExpenseInput[]; prevExpenses: ExpenseInput[]; budget: number; start: Date; end: Date; period: Period; now?: Date;
}): Forecast {
  const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
  const todayKey = keyOf(now), rawToday = indexOf(todayKey, start);
  const isCurrent = rawToday >= 0 && rawToday < dayCount, isPast = rawToday >= dayCount;
  const todayIndex = isCurrent ? rawToday : isPast ? dayCount - 1 : -1;
  const elapsed = todayIndex + 1, completed = isCurrent ? todayIndex : elapsed;

  const inPeriod = expenses.filter((e) => { const i = indexOf(e.date, start); return i >= 0 && i < dayCount; });
  const variableAmounts = inPeriod.filter((e) => !isFixedExpense(e)).map((e) => e.amount);
  const lumpCut = variableAmounts.length >= 6 ? median(variableAmounts) * 5 : Infinity;
  const daily = Array(dayCount).fill(0) as number[], variableDaily = Array(dayCount).fill(0) as number[], fixedDaily = Array(dayCount).fill(0) as number[];
  const lumps: ExpenseInput[] = [];
  inPeriod.forEach((e) => {
    const i = indexOf(e.date, start); daily[i] += e.amount;
    if (isFixedExpense(e)) fixedDaily[i] += e.amount;
    else if (e.amount > lumpCut) { fixedDaily[i] += e.amount; lumps.push(e); }
    else variableDaily[i] += e.amount;
  });

  const prevStart = previousPeriodStart(start, period), prevDays = Math.max(1, Math.round((start.getTime() - prevStart.getTime()) / DAY));
  const prevVariable = prevExpenses.filter((e) => !isFixedExpense(e));
  const prevCut = prevVariable.length >= 6 ? median(prevVariable.map((e) => e.amount)) * 5 : Infinity;
  const prevTotal = sum(prevVariable.filter((e) => e.amount <= prevCut).map((e) => e.amount));
  const prior = prevTotal > 0 ? prevTotal / prevDays : null;

  const observed = variableDaily.slice(0, completed);
  let observedRate = 0;
  if (observed.length) {
    let ewma = observed[0];
    for (let i = 1; i < observed.length; i++) ewma = 0.25 * observed[i] + 0.75 * ewma;
    observedRate = 0.5 * (sum(observed) / observed.length) + 0.5 * ewma;
  }
  const SHRINK_DAYS = 4;
  let dailyRate = prior === null ? observedRate : (observed.length * observedRate + SHRINK_DAYS * prior) / (observed.length + SHRINK_DAYS);
  if (!observed.length && prior === null) dailyRate = isCurrent ? variableDaily[todayIndex] : 0;

  const upcoming: { label: string; amount: number }[] = [];
  if (isCurrent) {
    const wanted = period === "month" ? "monthly" : "weekly";
    const present = new Set(inPeriod.map(signature)), presentCategories = new Set(inPeriod.map((e) => e.category.toLowerCase()));
    const added = new Set<string>();
    prevExpenses.forEach((p) => {
      const sig = signature(p);
      if (p.recurring.toLowerCase() !== wanted || added.has(sig) || present.has(sig)) return;
      if (!p.name.trim() && presentCategories.has(p.category.toLowerCase())) return;
      added.add(sig); upcoming.push({ label: p.name.trim() || p.category, amount: p.amount });
    });
  }
  const upcomingTotal = sum(upcoming.map((u) => u.amount));

  const spent = sum(daily), spentToday = isCurrent ? daily[todayIndex] : 0, fixedSpent = sum(fixedDaily);
  const daysAfterToday = isCurrent ? dayCount - 1 - todayIndex : isPast ? 0 : dayCount;
  const todayRest = isCurrent ? Math.max(0, dailyRate - variableDaily[todayIndex]) : 0;
  const forecast = spent + upcomingTotal + todayRest + dailyRate * daysAfterToday;
  const spread = (observed.length >= 3 ? stdDev(observed) : dailyRate * 0.6) * Math.sqrt(daysAfterToday);
  const forecastLow = Math.max(spent + upcomingTotal, forecast - spread), forecastHigh = forecast + spread;

  const cumulative: number[] = [];
  for (let i = 0, run = 0; i < elapsed; i++) { run += daily[i]; cumulative.push(run); }
  // Budget pace line: fixed bills count when they land; the rest of the budget spreads evenly across the period.
  const variableBudget = Math.max(0, budget - fixedSpent - upcomingTotal);
  const ideal: number[] = [];
  for (let i = 0, fixedRun = 0; i < dayCount; i++) {
    fixedRun += fixedDaily[i];
    const upcomingPart = upcomingTotal && daysAfterToday > 0 ? upcomingTotal * Math.max(0, i - todayIndex) / daysAfterToday : 0;
    ideal.push(budget ? fixedRun + upcomingPart + variableBudget * (i + 1) / dayCount : 0);
  }
  const expectedToday = budget && todayIndex >= 0 ? ideal[todayIndex] : 0;
  const delta = expectedToday - (cumulative[todayIndex] ?? 0);

  let safeToday = 0, leftToday = 0;
  if (budget && isCurrent) {
    const available = budget - (spent - spentToday) - upcomingTotal - fixedDaily[todayIndex];
    safeToday = Math.max(0, available / (dayCount - todayIndex));
    leftToday = safeToday - variableDaily[todayIndex];
  } else if (budget) safeToday = Math.max(0, budget - upcomingTotal) / dayCount;

  let runOutDate: string | null = null;
  if (budget && isCurrent && dailyRate > 0 && spent <= budget) {
    const left = budget - spent - upcomingTotal - todayRest;
    const index = left <= 0 ? todayIndex : todayIndex + Math.floor(left / dailyRate) + 1;
    if (index < dayCount) runOutDate = keyOf(addDays(start, index));
  }

  let status: PaceStatus = "none";
  if (budget) {
    const ratio = (isPast ? spent : forecast) / budget;
    status = spent > budget ? "over" : ratio <= 0.9 ? "comfortable" : ratio <= 1 ? "on-track" : ratio <= 1.1 ? "tight" : "overshoot";
  }

  return {
    dayCount, todayIndex, elapsed, isCurrent, isPast, daily, variableDaily, cumulative, ideal, spent, spentToday, fixedSpent, lumps,
    dailyRate, upcoming, upcomingTotal, forecast, forecastLow, forecastHigh, expectedToday, delta, safeToday, leftToday, runOutDate, status,
  };
}

export function paceStatusLabel(status: PaceStatus) {
  return { none: "No budget", comfortable: "Comfortable", "on-track": "On track", tight: "Tight", overshoot: "Too fast", over: "Over budget" }[status];
}

/** Consecutive recorded days, ending yesterday (or today if it is still within allowance), that stayed within the day's allowance. */
export function budgetStreak(days: DayInput[], todayIndex: number) {
  if (todayIndex < 0) return 0;
  let streak = 0;
  const from = days[todayIndex] && days[todayIndex].status !== "over" && days[todayIndex].spent > 0 ? todayIndex : todayIndex - 1;
  for (let i = from; i >= 0; i--) { if (days[i].status === "over") break; streak++; }
  return streak;
}

export function expenseInsights({ expenses, prevExpenses, forecast, budget, period, start, days }: {
  expenses: ExpenseInput[]; prevExpenses: ExpenseInput[]; forecast: Forecast; budget: number; period: Period; start: Date; days: DayInput[];
}): Insight[] {
  const out: Insight[] = [];
  const f = forecast, word = period === "month" ? "month" : "week";
  if (!expenses.length) return out;

  // 1. Where the period is heading.
  if (budget && !f.isPast) {
    if (f.status === "over") out.push({ id: "over", tone: "bad", icon: "🚨", score: 100, title: `${money(f.spent - budget)} over budget`, detail: `Every rupee from here adds to the overshoot. Keep the remaining ${f.dayCount - f.elapsed} days to essentials.` });
    else if (f.runOutDate) out.push({ id: "runout", tone: "bad", icon: "⏳", score: 95, title: `Budget runs out around ${shortDate(f.runOutDate)}`, detail: `At your recent ${money(f.dailyRate)}/day, the money ends before the ${word} does. Keep today under ${money(f.safeToday)} to push that date out.` });
    else if (f.forecast > budget) out.push({ id: "forecast", tone: "warn", icon: "📈", score: 85, title: `Heading for ${money(f.forecast)} — ${money(f.forecast - budget)} over`, detail: `Likely range ${money(f.forecastLow)}–${money(f.forecastHigh)}. Spending ${money(f.safeToday)} or less a day lands you on budget.` });
    else out.push({ id: "forecast", tone: "good", icon: "🎯", score: 45, title: `Heading for ${money(f.forecast)} — ${money(budget - f.forecast)} under`, detail: `Likely range ${money(f.forecastLow)}–${money(f.forecastHigh)}, based on your recent daily pace${f.upcomingTotal ? " and bills still to come" : ""}.` });
  } else if (!budget && !f.isPast && f.elapsed > 0) {
    const prevTotal = sum(prevExpenses.map((e) => e.amount));
    const suggested = roundTo(Math.max(prevTotal, f.forecast) * 0.9, 500);
    out.push({ id: "suggest-budget", tone: "info", icon: "🧭", score: 70, title: `On track for about ${money(f.forecast)} this ${word}`, detail: `A budget of ${money(suggested)} would be 10% below your usual — set it to unlock daily allowance and alerts.` });
  }

  if (f.upcomingTotal > 0) {
    const names = f.upcoming.slice(0, 3).map((u) => u.label).join(", ");
    out.push({ id: "upcoming", tone: "info", icon: "🗓️", score: 55, title: `${money(f.upcomingTotal)} of recurring bills still to come`, detail: `${names}${f.upcoming.length > 3 ? " and more" : ""} landed last ${word} but not yet this one. Flow has already reserved them in your forecast and allowance.` });
  }

  // 2. Category shifts versus the same point last period.
  const minDays = period === "month" ? 5 : 3;
  if (prevExpenses.length && f.elapsed >= minDays) {
    const prevStart = previousPeriodStart(start, period), cutoff = f.isPast ? Infinity : f.elapsed;
    const now = new Map<string, number>(), before = new Map<string, number>();
    expenses.forEach((e) => now.set(e.category, (now.get(e.category) || 0) + e.amount));
    prevExpenses.forEach((e) => { if (indexOf(e.date, prevStart) < cutoff) before.set(e.category, (before.get(e.category) || 0) + e.amount); });
    // Fixed categories swing with bill timing, so only day-to-day categories are compared.
    const variable = (cat: string) => !FIXED_CATEGORIES.has(cat.toLowerCase());
    const shifts = [...now.entries()].filter(([cat]) => variable(cat)).map(([cat, value]) => ({ cat, value, prev: before.get(cat) || 0 }));
    const up = shifts.filter((s) => s.prev > 0 && s.value >= Math.max(500, f.spent * 0.05) && s.value / s.prev >= 1.3).sort((a, b) => (b.value - b.prev) - (a.value - a.prev))[0];
    if (up) out.push({ id: "cat-up", tone: "warn", icon: "🔺", score: 75, title: `${up.cat} is up ${pct(up.value / up.prev - 1)}`, detail: `${money(up.value)} so far vs ${money(up.prev)} at this point last ${word}.` });
    const down = [...before.entries()].map(([cat, prev]) => ({ cat, prev, value: now.get(cat) || 0 }))
      .filter((s) => variable(s.cat) && s.prev >= 500 && s.value > 0 && s.value <= s.prev * 0.7).sort((a, b) => (b.prev - b.value) - (a.prev - a.value))[0];
    if (down) out.push({ id: "cat-down", tone: "good", icon: "🔻", score: 40, title: `${down.cat} is down ${pct(1 - down.value / down.prev)}`, detail: `${money(down.value)} vs ${money(down.prev)} at this point last ${word}. Nice cut.` });
  }

  // 3. A single spend far above your usual (kept out of the daily pace so it doesn't skew the forecast).
  const lump = [...f.lumps].sort((a, b) => b.amount - a.amount)[0];
  if (lump) {
    const typical = median(expenses.filter((e) => !isFixedExpense(e)).map((e) => e.amount));
    out.push({ id: "lump", tone: "info", icon: "🔍", score: 60, title: `Unusual: ${money(lump.amount)} on ${lump.category}`, detail: `${shortDate(lump.date)} — about ${Math.round(lump.amount / Math.max(1, typical))}× your typical ${money(typical)} spend. Flow counted it once instead of treating it as your daily pace.` });
  }

  // 4. Weekend effect.
  const observedDays = f.isCurrent ? f.todayIndex : f.elapsed;
  if (observedDays >= 7) {
    let weekend = 0, weekendDays = 0, weekday = 0, weekdayDays = 0;
    for (let i = 0; i < observedDays; i++) {
      const dow = addDays(start, i).getDay();
      if (dow === 0 || dow === 6) { weekend += f.variableDaily[i]; weekendDays++; } else { weekday += f.variableDaily[i]; weekdayDays++; }
    }
    const we = weekendDays ? weekend / weekendDays : 0, wd = weekdayDays ? weekday / weekdayDays : 0;
    if (weekendDays >= 2 && wd > 0 && we >= wd * 1.4 && we - wd >= 200) out.push({ id: "weekend", tone: "warn", icon: "🎉", score: 58, title: `Weekends cost ${(we / wd).toFixed(1)}× more`, detail: `${money(we)} per weekend day vs ${money(wd)} on weekdays. Planning one weekend treat in advance usually trims this.` });
  }

  // 5. Small leaks.
  const small = expenses.filter((e) => !isFixedExpense(e) && e.amount <= 250);
  const smallTotal = sum(small.map((e) => e.amount));
  if (small.length >= 8 && smallTotal >= f.spent * 0.1) out.push({ id: "leaks", tone: "info", icon: "💧", score: 50, title: `${small.length} small spends add up to ${money(smallTotal)}`, detail: `Each was ₹250 or less, together ${pct(smallTotal / Math.max(1, f.spent))} of this ${word}. Chai, snacks and quick rides are the usual culprits.` });

  // 6. Concentration.
  const byCat = new Map<string, number>(); expenses.forEach((e) => byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount));
  const [topCat, topValue] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (byCat.size >= 3 && f.spent >= 2000 && topValue / f.spent >= 0.4 && !FIXED_CATEGORIES.has(topCat.toLowerCase())) out.push({ id: "concentration", tone: "info", icon: "🥧", score: 48, title: `${pct(topValue / f.spent)} went to ${topCat}`, detail: `It's your biggest lever — a 20% cut there saves about ${money(topValue * 0.2)} this ${word}.` });

  // 7. Good habits.
  const streak = budget ? budgetStreak(days, f.todayIndex) : 0;
  if (streak >= 3) out.push({ id: "streak", tone: "good", icon: "🔥", score: 42, title: `${streak}-day streak within allowance`, detail: "Every day under your allowance lifts tomorrow's allowance a little." });
  const noSpend = f.daily.slice(0, observedDays).filter((v) => v === 0).length;
  if (observedDays >= 5 && noSpend >= 2) out.push({ id: "no-spend", tone: "good", icon: "🌱", score: 35, title: `${noSpend} no-spend days`, detail: `Out of ${observedDays} days so far this ${word}.` });

  return out.sort((a, b) => b.score - a.score);
}

export function savingsInsights({ savings, totalSavings, saved, used, periodSpent, monthlySpend, period, now = new Date() }: {
  savings: SavingInput[]; totalSavings: number; saved: number; used: number; periodSpent: number; monthlySpend: number; period: Period; now?: Date;
}): Insight[] {
  const out: Insight[] = [];
  if (!savings.length) return out;
  const word = period === "month" ? "month" : "week";

  if (monthlySpend > 0 && totalSavings > 0) {
    const months = totalSavings / monthlySpend, target = roundTo(monthlySpend * 6, 1000), gap = Math.max(0, target - totalSavings);
    const tone: InsightTone = months < 1 ? "bad" : months < 3 ? "warn" : months < 6 ? "info" : "good";
    out.push({ id: "emergency", tone, icon: "🛟", score: tone === "good" ? 45 : 90 - months * 5,
      title: `Emergency cover: ${months >= 12 ? "12+" : months.toFixed(1)} months`,
      detail: gap > 0 ? `Your savings cover about ${months.toFixed(1)} months of spending. Six months is ${money(target)} — about ${money(roundTo(gap / 12, 100))} a month gets you there in a year.` : `Your savings cover six months of spending. Money beyond this can work harder in investments.` });
  }

  const net = saved - used;
  if ((saved > 0 || used > 0) && net + periodSpent > 0) {
    const rate = net / (Math.max(0, net) + periodSpent);
    if (rate >= 0.2) out.push({ id: "rate", tone: "good", icon: "💪", score: 50, title: `Savings rate this ${word}: ${pct(rate)}`, detail: "Share of your money flow that went into savings. 20% is the classic 50/30/20 target — you're above it." });
    else if (rate >= 0) out.push({ id: "rate", tone: "warn", icon: "📊", score: 65, title: `Savings rate this ${word}: ${pct(rate)}`, detail: `Getting to 20% means saving about ${money(Math.max(0, periodSpent * 0.25 - net))} more this ${word}.` });
    else out.push({ id: "rate", tone: "bad", icon: "📉", score: 80, title: `Savings shrank by ${money(-net)}`, detail: `Withdrawals beat deposits this ${word}. If that was planned, fine — otherwise top it back up on payday.` });
  }

  const deposits = savings.filter((s) => s.action === "deposit").map((s) => s.date).sort();
  const last = deposits[deposits.length - 1];
  if (last) {
    const gapDays = Math.round((parseKey(keyOf(now)).getTime() - parseKey(last).getTime()) / DAY);
    if (gapDays >= 30) out.push({ id: "gap", tone: "warn", icon: "⏰", score: 70, title: `No deposit in ${gapDays} days`, detail: `Last one was ${shortDate(last)}. An auto-transfer on salary day${monthlySpend ? ` of even ${money(roundTo(monthlySpend * 0.1, 500))}` : ""} makes saving the default.` });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function investmentInsights({ investments, now = new Date() }: { investments: InvestmentInput[]; now?: Date }): Insight[] {
  const out: Insight[] = [];
  if (!investments.length) return out;
  const todayKey = keyOf(now), today = parseKey(todayKey).getTime();
  const rows = investments.map((i) => {
    const years = Math.max(0, (today - parseKey(i.date).getTime()) / (365.25 * DAY));
    const ratio = i.invested > 0 ? i.current / i.invested : 1;
    return { ...i, years, ret: ratio - 1, annual: years >= 1 && ratio > 0 ? ratio ** (1 / years) - 1 : null };
  });

  const invested = sum(rows.map((r) => r.invested)), current = sum(rows.map((r) => r.current));
  if (invested > 0 && current > 0) {
    const years = sum(rows.map((r) => r.invested * r.years)) / invested;
    if (years >= 0.5) {
      const cagr = (current / invested) ** (1 / years) - 1, real = (1 + cagr) / (1 + INFLATION) - 1;
      const tone: InsightTone = cagr < 0 ? "bad" : cagr < INFLATION ? "warn" : cagr < 0.1 ? "info" : "good";
      out.push({ id: "cagr", tone, icon: "📈", score: tone === "bad" ? 90 : tone === "warn" ? 75 : 50, title: `Portfolio growing ~${(cagr * 100).toFixed(1)}% a year`,
        detail: `Estimated from how long your money has been invested (about ${years.toFixed(1)} years on average). After ~6% inflation that's ${real >= 0 ? "+" : ""}${(real * 100).toFixed(1)}% real growth.` });
    } else out.push({ id: "cagr", tone: current >= invested ? "good" : "warn", icon: "📈", score: 40, title: `${current >= invested ? "+" : "−"}${pct(Math.abs(current / invested - 1))} overall so far`, detail: "Most of your money is under six months old — yearly growth becomes meaningful after that." });
  }

  const ranked = rows.filter((r) => r.invested > 0).sort((a, b) => (b.annual ?? b.ret) - (a.annual ?? a.ret));
  if (ranked.length >= 2) {
    const best = ranked[0], worst = ranked[ranked.length - 1];
    out.push({ id: "best", tone: "good", icon: "🏆", score: 38, title: `Best: ${best.name} ${best.ret >= 0 ? "+" : "−"}${pct(Math.abs(best.ret))}`, detail: best.annual !== null ? `About ${(best.annual * 100).toFixed(1)}% a year since ${monthYear(best.date)}.` : `Since ${monthYear(best.date)}.` });
    if (worst.ret < -0.05) out.push({ id: "worst", tone: "warn", icon: "🩹", score: 62, title: `${worst.name} is down ${pct(-worst.ret)}`, detail: `${money(worst.current)} now vs ${money(worst.invested)} invested. Check whether the reason you bought it still holds before adding more.` });
  }

  const byType = new Map<string, number>(); rows.forEach((r) => byType.set(r.type, (byType.get(r.type) || 0) + r.current));
  const [topType, topValue] = [...byType.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (rows.length >= 2 && current > 0 && topValue / current >= 0.6) out.push({ id: "concentration", tone: "warn", icon: "⚖️", score: 60, title: `${pct(topValue / current)} is in ${topType}`, detail: "Spreading across equity, debt and gold means one market doesn't decide everything." });

  rows.filter((r) => r.maturity).forEach((r) => {
    const days = Math.round((parseKey(r.maturity).getTime() - today) / DAY);
    if (days < 0 && days >= -90) out.push({ id: `matured-${r.name}`, tone: "warn", icon: "🔔", score: 80, title: `${r.name} matured on ${shortDate(r.maturity)}`, detail: "Update its value, then reinvest or move it — idle maturity money earns savings-account interest at best." });
    else if (days >= 0 && days <= 45) out.push({ id: `maturing-${r.name}`, tone: "info", icon: "🔔", score: 65, title: `${r.name} matures in ${days} day${days === 1 ? "" : "s"}`, detail: `On ${shortDate(r.maturity)}. Decide now where ${money(r.current)} goes next.` });
  });

  // Fixed-income holdings whose recorded value lags the quarterly-compounded value at their stated rate.
  rows.filter((r) => (r.type === "FD" || r.type === "Bonds") && r.rate && r.rate > 0 && r.years >= 0.25).forEach((r) => {
    const heldYears = r.maturity ? Math.min(r.years, Math.max(0, (parseKey(r.maturity).getTime() - parseKey(r.date).getTime()) / (365.25 * DAY))) : r.years;
    const expected = r.invested * (1 + (r.rate as number) / 400) ** (4 * heldYears);
    if (r.current < expected * 0.97) out.push({ id: `stale-${r.name}`, tone: "info", icon: "✏️", score: 45, title: `Update ${r.name}'s value`, detail: `At ${r.rate}% it should be about ${money(expected)} by now; Flow shows ${money(r.current)}.` });
  });

  return out.sort((a, b) => b.score - a.score);
}
