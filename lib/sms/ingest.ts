import { createHash } from "node:crypto";
import { aiChat } from "@/lib/ai-roast";
import { rupeesToPaise, paiseToRupees } from "@/lib/money";
import { amountBand, isOwnName, keywordCategory, looksLikePerson, payeeKey, shortLabel, suggestionsFor, type Suggestion } from "@/lib/sms/classify";
import { accountLabel, parseBankSms, type ParsedSms } from "@/lib/sms/parse";
import { Expense } from "@/models/Expense";
import { PayeeRule } from "@/models/PayeeRule";
import { User } from "@/models/User";

// Bank SMS → Flow. The Android app forwards new bank SMS here and shows whatever `notify` says. All reading and
// deciding happens on the server, so improving it only needs a web deploy, never a new APK.

export const EXPENSE_CATEGORIES = [
  "Food & Dining", "Groceries", "Travel & Transport", "Bills & Utilities", "Rent", "Shopping", "Entertainment", "Subscriptions",
  "Health", "Education", "EMI / Loan", "Insurance", "Personal Care", "Gifts", "Taxes", "Business Expense", "Inventory / Stock",
  "Office & Supplies", "Marketing", "Professional Fees", "Other",
];

export type Notify = { title: string; body: string; actions: Suggestion[] };
export type IngestResult =
  | { status: "unreadable" | "credit" | "duplicate" | "account-off" }
  | { status: "transfer"; notify?: Notify }
  | { status: "auto" | "ask"; expenseId: string; notify: Notify };

const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
const firstName = (payee: string) => { const word = payee.split(/\s+/)[0] ?? ""; return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); };

export async function ingestSms({ userId, userName, text, sender, receivedAt }: { userId: string; userName: string; text: string; sender: string; receivedAt: Date }): Promise<IngestResult> {
  const parsed = parseBankSms(text, sender, receivedAt) ?? await aiParseSms(text, receivedAt);
  if (!parsed) return { status: "unreadable" };
  if (parsed.kind === "credit") return { status: "credit" };

  const account = accountLabel(parsed);
  if (account && !(await accountEnabled(userId, account))) return { status: "account-off" };

  const smsRef = parsed.ref ? `ref:${parsed.ref}` : `h:${createHash("sha1").update(text.replace(/\s+/g, " ").trim()).digest("hex")}`;
  if (await Expense.exists({ userId, smsRef })) return { status: "duplicate" };

  const payee = parsed.payee || (parsed.method === "ATM" ? "ATM withdrawal" : "Unknown payee");
  const key = payeeKey(payee, parsed.vpa), band = amountBand(parsed.amount);
  const title = `${rupees(parsed.amount)} ${parsed.method === "Card" ? "at" : "to"} ${payee}`;
  const rule = key ? await PayeeRule.findOne({ userId, payeeKey: key, band }).lean() : null;

  if (rule?.kind === "transfer") return { status: "transfer" }; // the user already said this payee isn't spending: stay quiet
  if (!rule && isOwnName(payee, userName)) {
    return { status: "transfer", notify: { title, body: "Sent to an account in your own name, so it's not counted as spending.", actions: [] } };
  }

  const known = rule?.kind === "expense" && rule.category ? String(rule.category) : "";
  const keyword = known ? "" : keywordCategory(payee, parsed.vpa);
  const confident = known || keyword;
  const person = looksLikePerson(payee, parsed.vpa);
  // Not sure: offer a guess from the same payee at other amounts, or (if AI is set up) from the shop name.
  const guess = confident ? "" : await otherBandCategory(userId, key, band) || (person ? "" : await aiGuessCategory(payee, parsed.amount));

  const doc = await saveExpense({ userId, parsed, payee, account, smsRef, category: confident || guess || "Other", needsReview: !confident });
  if (!doc) return { status: "duplicate" };
  const expenseId = String(doc._id);
  if (rule) await PayeeRule.updateOne({ _id: rule._id }, { $inc: { uses: 1 } });

  if (confident) {
    return { status: "auto", expenseId, notify: { title, body: `Added as ${shortLabel(confident)}${known ? "" : " · tap to change"}${account ? ` · ${account}` : ""}`, actions: [{ label: "Not spending", kind: "transfer" }] } };
  }
  return { status: "ask", expenseId, notify: { title, body: `What was it? Flow will remember ${firstName(payee)} next time.`, actions: suggestionsFor({ amount: parsed.amount, person, guess, method: parsed.method }) } };
}

async function saveExpense({ userId, parsed, payee, account, smsRef, category, needsReview }: { userId: string; parsed: ParsedSms; payee: string; account: string; smsRef: string; category: string; needsReview: boolean }) {
  try {
    return await Expense.create({
      userId, amountPaise: rupeesToPaise(parsed.amount), category, dateKey: parsed.date, name: payee.slice(0, 120),
      payment: parsed.method === "Card" ? "Debit Card" : parsed.method === "ATM" ? "Cash" : parsed.method || "Bank Transfer",
      extra: `Added from bank SMS${account ? ` · ${account}` : ""}`, source: "sms", smsRef, payee: payee.slice(0, 60), account, needsReview,
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === 11000) return null; // same SMS arrived twice at once
    throw error;
  }
}

async function accountEnabled(userId: string, label: string) {
  const now = new Date();
  const updated = await User.findOneAndUpdate({ _id: userId, "smsAccounts.label": label }, { $set: { "smsAccounts.$.lastSeenAt": now } }, { returnDocument: "after" }).select("smsAccounts").lean();
  if (updated) return updated.smsAccounts?.find((a: { label: string }) => a.label === label)?.enabled !== false;
  await User.updateOne({ _id: userId, "smsAccounts.label": { $ne: label } }, { $push: { smsAccounts: { label, enabled: true, lastSeenAt: now } } });
  return true;
}

async function otherBandCategory(userId: string, key: string, band: string) {
  if (!key) return "";
  const other = await PayeeRule.findOne({ userId, payeeKey: key, band: { $ne: band }, kind: "expense" }).sort({ uses: -1 }).lean();
  return other?.category ? String(other.category) : "";
}

/**
 * Learns from the user's answer and applies it to this expense plus any other unanswered ones from the same payee and
 * amount band. kind "transfer" means "not spending": those expenses are removed.
 */
export async function resolveSmsExpense({ userId, expenseId, kind, category }: { userId: string; expenseId: string; kind: "expense" | "transfer"; category?: string }) {
  const doc = await Expense.findOne({ _id: expenseId, userId, source: "sms" }).lean();
  if (!doc) return null;
  const amount = paiseToRupees(Number(doc.amountPaise)), payee = String(doc.payee || doc.name || "");
  const key = payeeKey(payee), band = amountBand(amount);
  if (kind === "expense" && (!category || !EXPENSE_CATEGORIES.includes(category))) throw new Error("BAD_CATEGORY");
  if (key) await rememberPayee({ userId, payee, amount, kind, category: category ?? "" });

  const pending = (await Expense.find({ userId, source: "sms", needsReview: true, _id: { $ne: doc._id } }).select("payee name amountPaise").lean())
    .filter((other) => payeeKey(String(other.payee || other.name || "")) === key && amountBand(paiseToRupees(Number(other.amountPaise))) === band)
    .map((other) => other._id);
  const ids = [doc._id, ...pending];
  if (kind === "transfer") await Expense.deleteMany({ userId, _id: { $in: ids } });
  else await Expense.updateMany({ userId, _id: { $in: ids } }, { category, needsReview: false });
  return { applied: ids.length, payee, kind, category: category ?? "" };
}

export async function rememberPayee({ userId, payee, amount, kind, category }: { userId: string; payee: string; amount: number; kind: "expense" | "transfer"; category: string }) {
  const key = payeeKey(payee);
  if (!key) return;
  await PayeeRule.updateOne(
    { userId, payeeKey: key, band: amountBand(amount) },
    { $set: { kind, category: kind === "expense" ? category : "", payee: payee.slice(0, 60) }, $inc: { uses: 1 } },
    { upsert: true },
  );
}

// --- Optional AI help (only when an AI provider is configured; see lib/ai-roast.ts) ---------------------------------

/** Guess a category from a shop name. Only the payee name and amount are sent; the answer is a suggestion, never final. */
async function aiGuessCategory(payee: string, amount: number) {
  const reply = await aiChat(
    `You categorise Indian UPI/card payees for a personal expense tracker. Reply with exactly one of these categories, or "unknown" if the name gives no real clue (for example a person's name):\n${EXPENSE_CATEGORIES.join("\n")}`,
    `Payee: ${payee}\nAmount: ₹${amount}`, { maxTokens: 300, temperature: 0, timeoutMs: 3000, label: "category" });
  const answer = reply?.split("\n").map((line) => line.trim().replace(/^["'*\s]+|["'*.\s]+$/g, "")).filter(Boolean).pop() ?? "";
  return EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === answer.toLowerCase()) ?? "";
}

/** Last resort for SMS formats the rules don't know. Long digit runs (account/phone/reference numbers) are masked first. */
async function aiParseSms(text: string, receivedAt: Date): Promise<ParsedSms | null> {
  if (!/(?:rs\.?|inr|₹)\s*[\d,]+/i.test(text)) return null;
  const masked = text.replace(/\d{9,}/g, "#########").replace(/(?:avl\.?|available|aval)\s*(?:bal|balance|lmt|limit)[^.]*\.?/gi, "").slice(0, 600);
  const reply = await aiChat(
    `Extract one bank transaction from an Indian bank SMS. Reply with JSON only: {"type":"debit"|"credit"|"none","amount":number,"payee":string,"date":"YYYY-MM-DD"|""}. Use "none" for OTPs, reminders, offers, failed or future payments.`,
    masked, { maxTokens: 300, temperature: 0, timeoutMs: 3500, label: "sms-parse" });
  const json = reply?.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const data = JSON.parse(json) as { type?: string; amount?: number; payee?: string; date?: string };
    if ((data.type !== "debit" && data.type !== "credit") || !(Number(data.amount) > 0)) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "") ? String(data.date) : `${receivedAt.getFullYear()}-${String(receivedAt.getMonth() + 1).padStart(2, "0")}-${String(receivedAt.getDate()).padStart(2, "0")}`;
    return { kind: data.type, amount: Math.round(Number(data.amount) * 100) / 100, payee: String(data.payee ?? "").slice(0, 60), vpa: "", ref: "", date, account: "", bank: "", method: /\bupi\b/i.test(text) ? "UPI" : "" };
  } catch {
    return null;
  }
}
