// Roasts one specific expense right after it's added — only when it actually deserves it.
import type { RoastLevel } from "@/lib/budget-nudge";
import { isFixedExpense } from "@/lib/insights";
import { addressVars } from "@/lib/nudges";

export type ExpenseRoastTrigger = "already-over" | "broke-budget" | "today-limit" | "big-spend" | "late-night";
export type ExpenseRoast = { level: RoastLevel; trigger: ExpenseRoastTrigger; title: string; line: string; vars: Record<string, string> };

const TEMPLATES: Record<ExpenseRoastTrigger, string[]> = {
  "already-over": [
    "Budget pehle se over tha. Aur tune {what} pe {amount} aur daal diye? Legend.",
    "Over budget + {amount} on {what}. Flow ko ab baithna padega.",
    "Girte hue budget ko {amount} ka dhakka. {what} ke liye. Wah.",
    "Budget ICU mein tha. {what} ne oxygen bhi nikaal di. {amount}.",
    "Already over, phir bhi {amount}? {what} itna zaroori tha?",
    "Flow: 'Bas kar.' Tu: '{what}, {amount}.' Classic.",
  ],
  "broke-budget": [
    "{amount} on {what} — aur isi ne budget tod diya. Congratulations? 🎉",
    "Budget ki last saans {what} ne li. {amount} ka final blow.",
    "Isi {amount} ka intezaar tha budget ko. Ab woh gaya.",
    "{what} ne budget ka 'The End' likh diya. {amount} mein.",
    "Budget line cross. Culprit: {what}, {amount}. Case closed.",
    "Ye {amount} wala {what} history mein yaad rakha jayega. Budget ke khilaaf.",
  ],
  "today-limit": [
    "{amount} on {what} aur aaj ka allowance gaya. Baaki din: sirf dekhna.",
    "Aaj ka quota {what} kha gaya. {amount} mein.",
    "{what} ke {amount} ne aaj ka budget band kar diya. Shutter down.",
    "Allowance khatam. Last item: {what}. Worth it? Soch.",
    "Aaj ka limit cross, courtesy {what}. Kal sambhal lena.",
  ],
  "big-spend": [
    "{amount} on {what}? Ye tera usual {typical} ka {x}× hai. Flow has questions.",
    "{what} — {amount}. Normal din ka kharcha {typical} hota hai. Aaj kya festival hai?",
    "{x}× your usual spend. {what} better be worth it.",
    "{amount} ek hi baar mein. {what} ne tujhe kaise convince kiya?",
    "Ye {amount} wala {what} Flow ke radar pe hai. 👀",
  ],
  "late-night": [
    "{time} pe {amount} on {what}? Raat ko dimaag half-price pe chalta hai.",
    "Late-night {what}, {amount}. Kal subah pachhtawa free milega.",
    "Raat ke {time} baje {what}? Neend sasti thi, {bro}.",
    "Night owl mode: {amount} on {what}. Flow bhi jaag raha hai. 👀",
  ],
};

const TITLES: Record<ExpenseRoastTrigger, string> = {
  "already-over": "Budget was already over",
  "broke-budget": "This one broke the budget",
  "today-limit": "Today's allowance: gone",
  "big-spend": "That's a big one",
  "late-night": "Late-night spend detected",
};

function money(value: number) { return `₹${Math.round(value || 0).toLocaleString("en-IN")}`; }
function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Typical everyday spend: median of recent non-fixed expenses. */
export function typicalSpend(expenses: { amount: number; category: string; date: string; name: string; type: string; recurring: string }[]) {
  return median(expenses.filter((e) => !isFixedExpense(e)).map((e) => e.amount));
}

export function expenseRoast({ expense, budget, spentBefore, leftTodayBefore, inCurrentPeriod, isToday, typical, address, now = new Date() }: {
  expense: { amount: number; category: string; date: string; name: string; type: string; recurring: string };
  budget: number; spentBefore: number; leftTodayBefore: number; inCurrentPeriod: boolean; isToday: boolean; typical: number; address?: string | null; now?: Date;
}): ExpenseRoast | null {
  const amount = expense.amount, hour = now.getHours();
  let trigger: ExpenseRoastTrigger | null = null, level: RoastLevel = "hot";
  if (budget && inCurrentPeriod && spentBefore > budget) { trigger = "already-over"; level = spentBefore + amount >= budget * 1.2 ? "inferno" : "hot"; }
  else if (budget && inCurrentPeriod && spentBefore + amount > budget) trigger = "broke-budget";
  else if (budget && isToday && !isFixedExpense(expense) && leftTodayBefore >= 0 && leftTodayBefore - amount < 0) { trigger = "today-limit"; level = "mild"; }
  else if (typical > 0 && amount >= typical * 3 && amount >= 1000 && !isFixedExpense(expense)) trigger = "big-spend";
  else if (isToday && (hour >= 23 || hour < 4)) { trigger = "late-night"; level = "mild"; }
  if (!trigger) return null;

  const vars = {
    amount: money(amount), what: expense.name.trim() || expense.category, category: expense.category,
    typical: money(typical), x: typical ? String(Math.max(2, Math.round(amount / typical))) : "",
    time: new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(now),
    ...addressVars(address),
  };
  const options = TEMPLATES[trigger];
  let hash = 0;
  for (const char of `${amount}|${expense.category}|${now.toDateString()}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const line = options[hash % options.length].replace(/\{(\w+)\}/g, (_, key: string) => vars[key as keyof typeof vars] ?? "");
  return { level, trigger, title: TITLES[trigger], line, vars };
}
