// Decides whether today deserves a roast or praise. Shared by the dashboard card and the phone notification.
import { budgetStreak, type Forecast } from "@/lib/insights";
import { BUDGET_PRAISE, BUDGET_ROASTS, INFERNO_ROASTS, MILD_ROASTS, dailyNudge } from "@/lib/nudges";

export type RoastLevel = "mild" | "hot" | "inferno";
export type BudgetNudge = { tone: "roast" | "praise"; level?: RoastLevel; label: string; line: string };
type DayStatus = { date: string; spent: number; target: number; status: "none" | "good" | "equal" | "over" };

function money(value: number) { return `₹${Math.round(value || 0).toLocaleString("en-IN")}`; }
function keyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Each day's spend against a rolling allowance (what's left ÷ days left), the same rule the calendar uses. */
export function dayStatuses(expenses: { date: string; amount: number }[], budget: number, start: Date, dayCount: number): DayStatus[] {
  const byDay = new Map<string, number>();
  expenses.forEach((e) => byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount));
  let remaining = budget;
  const days: DayStatus[] = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const date = keyOf(d), spent = byDay.get(date) || 0;
    const target = budget ? Math.max(0, remaining / Math.max(1, dayCount - i)) : 0;
    const ratio = target ? spent / target : 0;
    const status: DayStatus["status"] = spent <= 0 || !budget ? "none" : ratio < .95 ? "good" : ratio <= 1.05 ? "equal" : "over";
    days.push({ date, spent, target, status }); remaining -= spent;
  }
  return days;
}

export function budgetNudge({ forecast, budget, days, hasExpenses, name, topCategory, seed, now = new Date() }: {
  forecast: Forecast; budget: number; days: { spent: number; status: DayStatus["status"] }[]; hasExpenses: boolean;
  name: string; topCategory: string; seed: string; now?: Date;
}): BudgetNudge | null {
  if (!budget || !forecast.isCurrent || !hasExpenses) return null;
  const vars = { name: name.trim().split(/\s+/)[0] || "Boss", top: topCategory || "shopping", streak: "", over: "" };
  let label = "", level: RoastLevel = "hot";
  if (forecast.status === "over") {
    label = `Budget crossed · ${money(forecast.spent - budget)} over`; vars.over = money(forecast.spent - budget);
    level = forecast.spent >= budget * 1.2 ? "inferno" : "hot";
  }
  else if (forecast.forecast > budget) { label = `At this pace · ${money(forecast.forecast - budget)} over by period end`; vars.over = money(forecast.forecast - budget); }
  else if (forecast.leftToday < 0) { label = `Today's allowance crossed · ${money(-forecast.leftToday)} over`; vars.over = money(-forecast.leftToday); level = "mild"; }
  const lines = level === "mild" ? MILD_ROASTS : level === "inferno" ? INFERNO_ROASTS : BUDGET_ROASTS;
  if (label) return { tone: "roast", level, label, line: dailyNudge(lines, seed, vars, now) };
  const streak = budgetStreak(days.map((d) => ({ date: "", ...d })), forecast.todayIndex);
  if (streak < 3) return null;
  vars.streak = String(streak);
  return { tone: "praise", label: `${streak}-day streak within allowance`, line: dailyNudge(BUDGET_PRAISE, seed, vars, now) };
}
