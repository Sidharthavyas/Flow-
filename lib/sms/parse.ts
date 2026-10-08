// One reader for Indian bank / card transaction SMS. There are no per-bank templates: every bank writes some mix of
// an amount (Rs./INR/₹), a debit or credit word, the payee after "to"/"at"/"credited to"/UPI path, a date, a reference
// number and the last digits of the account. Anything this can't read returns null, and the caller may ask AI instead.

export type SmsKind = "debit" | "credit";
export type ParsedSms = {
  kind: SmsKind; amount: number; payee: string; vpa: string; ref: string; date: string;
  account: string; bank: string; method: "UPI" | "Card" | "IMPS" | "NEFT" | "RTGS" | "ATM" | "Bank Transfer" | "";
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Sender IDs look like "AD-HDFCBK" / "VM-BOIIND-S"; the 6-letter core names the bank.
const SENDER_BANKS: [RegExp, string][] = [
  [/BOIIND|BOISMS/, "BOI"], [/HDFC/, "HDFC"], [/ICICI/, "ICICI"], [/SBI/, "SBI"], [/AXIS/, "Axis"], [/KOTAK/, "Kotak"],
  [/PNB/, "PNB"], [/BOB|BARODA/, "BoB"], [/CANBNK|CANARA/, "Canara"], [/UNION|UBOI/, "Union"], [/IDFC/, "IDFC"],
  [/YESB/, "Yes"], [/INDUS/, "IndusInd"], [/PAYTM/, "Paytm"], [/AIRBNK|AIRTEL/, "Airtel"], [/FEDBNK|FEDERAL/, "Federal"],
  [/IOB/, "IOB"], [/CENTBK|CBOI/, "Central"], [/AUBANK/, "AU"], [/RBL/, "RBL"], [/IDBI/, "IDBI"], [/BMAHA|MAHABK/, "BoM"],
];
const TEXT_BANKS: [RegExp, string][] = [
  [/bank of india|-\s*boi\b/i, "BOI"], [/hdfc/i, "HDFC"], [/icici/i, "ICICI"], [/\bsbi\b|state bank/i, "SBI"], [/axis/i, "Axis"],
  [/kotak/i, "Kotak"], [/\bpnb\b|punjab national/i, "PNB"], [/bank of baroda|\bbob\b/i, "BoB"], [/canara/i, "Canara"],
  [/union bank/i, "Union"], [/idfc/i, "IDFC"], [/yes bank/i, "Yes"], [/indusind/i, "IndusInd"], [/paytm/i, "Paytm"], [/federal/i, "Federal"],
];

const IGNORE = /\b(otp|one time password|will be debited|to be debited|is due|due on|requested|request received|mandate|failed|declined|reversed|refund(?:ed)? initiated|has been blocked|e-?mandate|autopay set)\b/i;
const DEBIT = /\b(debited|spent|sent|paid|withdrawn|withdrawal|purchase|dr\.?)\b/i;
const CREDIT = /\b(credited to (?:your|a\/?c|ac|acct)|has been credited|received|deposited|cr\.?)\b/i;
const STOP = String.raw`(?=\s+(?:via|on|ref|refno|upi|using|for|from|thru|through|avl|bal|info|not you|if not)\b|\s*[.;,(]|\s+-\s|$)`;

export function parseBankSms(raw: string, sender = "", receivedAt = new Date()): ParsedSms | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 15 || IGNORE.test(text)) return null;

  const amount = readAmount(text);
  if (!amount) return null;
  const isDebit = DEBIT.test(text);
  const isCredit = !isDebit && CREDIT.test(text);
  if (!isDebit && !isCredit) return null;

  const { payee, vpa } = isDebit ? readPayee(text) : { payee: "", vpa: "" };
  return {
    kind: isDebit ? "debit" : "credit",
    amount, payee, vpa,
    ref: readRef(text),
    date: readDate(text) || dateKey(receivedAt),
    account: readAccount(text),
    bank: readBank(text, sender),
    method: readMethod(text),
  };
}

function readAmount(text: string) {
  const match = text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) || text.match(/debited (?:by|for|with)\s*([\d,]+(?:\.\d{1,2})?)/i);
  const value = match ? Number(match[1].replace(/,/g, "")) : 0;
  return Number.isFinite(value) && value > 0 && value < 1e8 ? Math.round(value * 100) / 100 : 0;
}

function readPayee(text: string) {
  const patterns = [
    /UPI\/(?:P2[MA]|DR|CR)\/\d{6,}\/([^/]+?)(?:\/|\s+(?:not you|avl|bal)|$)/i, // Axis-style UPI path
    new RegExp(String.raw`credited to\s+(?!your\b|a\/?c\b|ac\b)(.+?)${STOP}`, "i"),
    new RegExp(String.raw`(?:trf to|transferred to|paid to|sent to|transfer to)\s+(.+?)${STOP}`, "i"),
    /;\s*([A-Za-z][^;]{1,50}?)\s+credited\b/i, // ICICI: "...on 07-Oct-26; RAJU credited"
    // Card SMS name the merchant with "at" — checked before the generic "to", which also appears in "To dispute, call…".
    new RegExp(String.raw`\bat\s+(?!atm\b|\d)([A-Za-z0-9][^\s].*?)${STOP}`, "i"),
    new RegExp(String.raw`\bto\s+(?:vpa\s+)?(?!your\b|a\/?c\b|ac\b|acct\b|dispute|block|report|call|sms|stop|unsubscribe)([A-Za-z0-9][^\s].*?)${STOP}`, "i"),
  ];
  for (const pattern of patterns) {
    const found = text.match(pattern)?.[1]?.trim();
    if (!found) continue;
    const cleaned = found.replace(/^(?:vpa|m\/s\.?|mr\.?|ms\.?|mrs\.?)\s+/i, "").replace(/\s+(?:ref|upi).*$/i, "").trim();
    if (!cleaned || /^\d+$/.test(cleaned)) continue;
    const vpa = cleaned.match(/[\w.-]+@[\w.-]+/)?.[0] ?? "";
    // A bare UPI ID like amitkirana@ybl: use the part before @ as the readable name.
    const name = vpa && cleaned === vpa ? vpa.split("@")[0].replace(/[._-]+/g, " ").replace(/\d{6,}/g, "").trim() || vpa : cleaned.replace(/[\w.-]+@[\w.-]+/, "").trim() || cleaned;
    return { payee: name.slice(0, 60), vpa };
  }
  return { payee: "", vpa: text.match(/[\w.-]+@[a-z]{2,}\b/i)?.[0] ?? "" };
}

function readRef(text: string) {
  return text.match(/(?:ref(?:erence)?\.?\s*(?:no\.?|number|id)?|refno|rrn|utr|upi(?:\s*ref)?|txn(?:\s*id)?)\s*[:.#-]?\s*(\d{9,})/i)?.[1]
    ?? text.match(/UPI\/(?:P2[MA]|DR|CR)\/(\d{9,})/i)?.[1] ?? "";
}

function readAccount(text: string) {
  const digits = text.match(/(?:a\/?c|acct|account|ac|card)\s*(?:no\.?|number)?\s*(?:ending\s*(?:with|in)?\s*)?[:\s]*[xX*.]*\s*(\d{3,6})\b/i)?.[1];
  return digits ? digits.slice(-4) : "";
}

function readBank(text: string, sender: string) {
  const code = sender.toUpperCase().replace(/[^A-Z]/g, "");
  return SENDER_BANKS.find(([re]) => re.test(code))?.[1] ?? TEXT_BANKS.find(([re]) => re.test(text))?.[1] ?? "";
}

function readMethod(text: string): ParsedSms["method"] {
  if (/\bupi\b|@\w/i.test(text)) return "UPI";
  if (/\batm\b/i.test(text)) return "ATM";
  if (/\bcard\b/i.test(text)) return "Card";
  if (/\bimps\b/i.test(text)) return "IMPS";
  if (/\bneft\b/i.test(text)) return "NEFT";
  if (/\brtgs\b/i.test(text)) return "RTGS";
  return "";
}

function readDate(text: string) {
  // Prefer a date introduced by "on"/"date"; otherwise any stand-alone date. ISO first.
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return valid(+iso[1], +iso[2], +iso[3]);
  const match = text.match(/(?:\bon|date)\s*:?\s*(\d{1,2})[-/ ]?([A-Za-z]{3}|\d{1,2})[-/ ]?(\d{4}|\d{2})\b/i)
    || text.match(/(?<!\d)(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{4}|\d{2})\b/i);
  if (!match) return "";
  const month = /\d/.test(match[2]) ? Number(match[2]) : MONTHS[match[2].toLowerCase()];
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return valid(year, month, Number(match[1]));
}

function valid(year: number, month: number, day: number) {
  if (!month || month > 12 || !day || day > 31 || year < 2000 || year > 2100) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "BOI ••0457", or "Account ••0457" when the bank is unknown. */
export function accountLabel(parsed: Pick<ParsedSms, "bank" | "account" | "method">) {
  const kind = parsed.method === "Card" ? "Card" : "Account";
  if (!parsed.account) return parsed.bank || "";
  return `${parsed.bank || kind} ••${parsed.account}`;
}
