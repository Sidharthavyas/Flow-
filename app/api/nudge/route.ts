import { NextRequest, NextResponse } from "next/server";
import { aiRoast, aiRoastEnabled } from "@/lib/ai-roast";
import { requireApiUser } from "@/lib/auth";
import { budgetNudge, dayStatuses } from "@/lib/budget-nudge";
import { dbConnect } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { computeForecast, keyOf, previousPeriodStart, type Period } from "@/lib/insights";
import { paiseToRupees } from "@/lib/money";
import { serializeExpense } from "@/lib/serializers";
import { Budget } from "@/models/Budget";
import { Expense } from "@/models/Expense";
import { RoastCache } from "@/models/RoastCache";

export const runtime = "nodejs";

// Today's roast or praise for the phone's notifications. The phone sends its own local date
// (?date=YYYY-MM-DD) so the server's timezone never shifts which day is "today", and a slot:
// "afternoon" / "evening" get different lines on the same day; "test" always answers so setup can be verified.
const TEST_MESSAGE = { show: true, tone: "test", title: "🔔 Flow notifications are on", body: "Aaj budget safe hai, toh roast nahi. Overspend kiya toh 1 PM aur 9 PM pe Flow bolega. 👀" };
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser();
    const dateParam = request.nextUrl.searchParams.get("date") ?? "";
    const slot = request.nextUrl.searchParams.get("slot") ?? "evening";
    const now = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(`${dateParam}T${slot === "afternoon" ? "13" : "20"}:00:00`) : new Date();
    const quiet = slot === "test" ? TEST_MESSAGE : { show: false };
    if (Number.isNaN(now.getTime())) return jsonError("Invalid date");

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    await dbConnect();
    const budgets = await Budget.find({ userId: user.id, $or: [
      { periodType: "month", periodStart: keyOf(monthStart) },
      { periodType: "week", periodStart: keyOf(weekStart) },
    ] }).lean();
    const chosen = budgets.find((b) => b.periodType === "month") ?? budgets.find((b) => b.periodType === "week");
    if (!chosen) return NextResponse.json(quiet, { headers: { "Cache-Control": "private, no-store" } });

    const period = chosen.periodType as Period, budget = paiseToRupees(Number(chosen.amountPaise));
    const start = period === "month" ? monthStart : weekStart;
    const end = period === "month" ? new Date(start.getFullYear(), start.getMonth() + 1, 1) : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const startKey = keyOf(start);
    const docs = await Expense.find({ userId: user.id, dateKey: { $gte: keyOf(previousPeriodStart(start, period)), $lt: keyOf(end) } })
      .select("amountPaise category dateKey name type recurring").lean();
    const all = docs.map((d) => serializeExpense(d as never));
    const expenses = all.filter((e) => e.date >= startKey), prevExpenses = all.filter((e) => e.date < startKey);

    const forecast = computeForecast({ expenses, prevExpenses, budget, start, end, period, now });
    const byCategory = new Map<string, number>();
    expenses.forEach((e) => byCategory.set(e.category, (byCategory.get(e.category) || 0) + e.amount));
    const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const nudge = budgetNudge({
      forecast, budget, days: dayStatuses(expenses, budget, start, forecast.dayCount), hasExpenses: expenses.length > 0,
      name: user.name, topCategory, seed: slot === "afternoon" ? `${user.id}:afternoon` : user.id, now,
    });

    // With an AI provider configured, the roast is written fresh from today's numbers — once per day and
    // situation, cached so the app (slot "app") and the 9 PM notification ("evening") show the same line.
    let body = nudge?.line ?? "";
    if (nudge?.tone === "roast" && aiRoastEnabled()) {
      const key = `${keyOf(now)}|${slot === "afternoon" ? "afternoon" : "main"}|${nudge.level}|${nudge.label.split(" · ")[0]}`;
      const cached = await RoastCache.findOne({ userId: user.id, key }).select("line").lean();
      if (cached) body = String(cached.line);
      else {
        const todaySpent = forecast.isCurrent ? forecast.spentToday : 0;
        const line = await aiRoast({
          level: nudge.level, situation: nudge.label, period, budget: `₹${budget}`, spentSoFar: `₹${Math.round(forecast.spent)}`,
          forecastByPeriodEnd: `₹${Math.round(forecast.forecast)}`, spentToday: `₹${Math.round(todaySpent)}`,
          biggestCategory: topCategory ? `${topCategory} (₹${Math.round(byCategory.get(topCategory) ?? 0)})` : undefined,
          daysLeft: forecast.dayCount - forecast.elapsed, timeOfDay: slot === "afternoon" ? "afternoon" : "evening",
        });
        if (line) {
          body = line;
          await RoastCache.updateOne({ userId: user.id, key }, { line, expiresAt: new Date(Date.now() + 2 * 86_400_000) }, { upsert: true }).catch(() => undefined);
        }
      }
    }

    return NextResponse.json(
      nudge ? { show: true, tone: nudge.tone, level: nudge.level, title: `${nudge.tone === "roast" ? "🔥" : "🏆"} ${nudge.label}`, body } : quiet,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
