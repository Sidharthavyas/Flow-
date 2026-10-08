// Turns a payee name into a category guess. Order of trust: what the user taught Flow (PayeeRule) > these keyword
// rules > an AI guess (only ever offered as a suggestion, never applied silently).

export type Band = "small" | "medium" | "large";
export type Suggestion = { label: string; kind: "expense" | "transfer"; category?: string };

/** Same payee, different typical amounts (₹30 chai vs ₹800 groceries from the same shop) get separate memories. */
export function amountBand(amount: number): Band {
  return amount <= 100 ? "small" : amount <= 1000 ? "medium" : "large";
}

/** Stable key for a payee: lower-case, no punctuation or company suffixes. "DELHIVERY PVT LTD" → "delhivery". */
export function payeeKey(payee: string, vpa = "") {
  const base = (payee || vpa).toLowerCase()
    .replace(/[\w.-]+@[\w.-]+/g, (id) => id.split("@")[0])
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|india|enterprises?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return base.slice(0, 60);
}

const words = (value: string) => value.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);

/** Money sent to an account in your own name ("SIDHARTHA MANOJ VYAS" for Sidhartha Vyas) is a transfer, not spending. */
export function isOwnName(payee: string, userName: string) {
  const mine = words(userName), theirs = words(payee);
  if (!mine.length || !theirs.length) return false;
  if (mine.length === 1) return theirs.length === 1 && theirs[0] === mine[0];
  return mine.every((w) => theirs.includes(w));
}

// Keyword → category, checked in order. Names must match FlowDashboard's EXPENSE_CATEGORIES.
const RULES: [RegExp, string][] = [
  [/\b(medical|medicos?|chemists?|pharma\w*|pharmacy|drug|hospital|clinic|diagnostic|pathology|lab(?:s|oratory)?|dental|apollo|netmeds|1mg|pharmeasy)\b/, "Health"],
  [/\b(petrol\w*|petroleum|fuel|filling|service station|hpcl|bpcl|iocl|indian oil|bharat petroleum|hindustan petroleum|nayara|shell|cng)\b/, "Travel & Transport"],
  [/\b(railways?|irctc|uber|ola|rapido|redbus|metro|makemytrip|goibibo|ixigo|indigo|air india|akasa|spicejet|fastag|parking|toll|auto|taxi|cab|travels?)\b/, "Travel & Transport"],
  [/\b(swiggy|zomato|eatsure|dominos?|pizza|mc ?donalds?|kfc|burger|subway|starbucks|chaayos|cafe|coffee|tea|chai|dosa|idli|dhaba|restaurant|resto|dining|diner|kitchen|biryani|bakery|bakers|sweets?|mithai|juice|snacks?|food|foods|eats?|canteen|mess|hotel|bhojnalaya|vada ?pav|pani ?puri|chinese|momos?|ice ?cream|haldiram)\b/, "Food & Dining"],
  [/\b(kirana|general store|provision|supermarket|super market|mart|dmart|d mart|bigbasket|blinkit|zepto|instamart|jiomart|grocer\w*|dairy|milk|vegetables?|sabzi|fruits?|ration)\b/, "Groceries"],
  [/\b(netflix|spotify|prime video|amazon prime|hotstar|jiocinema|youtube|apple|google play|sonyliv|zee5|icloud)\b/, "Subscriptions"],
  [/\b(electricity|msedcl|bescom|tata power|adani|torrent power|water bill|gas|indane|bharat gas|hp gas|broadband|airtel|jio|vodafone|vi\b|bsnl|recharge|dth|tata play)\b/, "Bills & Utilities"],
  [/\b(delhivery|nimbuspost|shiprocket|courier|dtdc|blue ?dart|ecom express|xpressbees|india post|speed post)\b/, "Business Expense"],
  [/\b(amazon|flipkart|myntra|ajio|meesho|nykaa|reliance|trends|lifestyle|westside|decathlon|croma|vijay sales|electronics|garments?|textiles?|footwear|shoes|fashion|boutique|collection)\b/, "Shopping"],
  [/\b(salon|saloon|parlou?r|barber|spa|hair|beauty)\b/, "Personal Care"],
  [/\b(school|college|academy|classes|tuition|coaching|institute|university|udemy|coursera|byjus|unacademy|books?|stationery)\b/, "Education"],
  [/\b(pvr|inox|cinema|movies?|bookmyshow|theatre|gaming|games?)\b/, "Entertainment"],
  [/\b(lic|insurance|policy|acko|digit|hdfc ergo|icici lombard|star health)\b/, "Insurance"],
  [/\b(emi|loan|bajaj finance|finance|credit card bill)\b/, "EMI / Loan"],
];

export function keywordCategory(payee: string, vpa = "") {
  const haystack = ` ${payee} ${vpa.replace(/@.*/, "").replace(/[._-]/g, " ")} `.toLowerCase();
  const exact = RULES.find(([re]) => re.test(haystack))?.[1];
  if (exact) return exact;
  // UPI IDs run words together ("amitkirana@ybl"), so look for longer keywords inside them too.
  const joined = `${vpa.replace(/@.*/, "")} ${payee.includes(" ") ? "" : payee}`.toLowerCase().replace(/[^a-z]/g, "");
  if (joined.length < 6) return "";
  return LOOSE.find(([re]) => re.test(joined))?.[1] ?? "";
}

const LOOSE: [RegExp, string][] = [
  [/medical|chemist|pharma/, "Health"], [/petrol|fuel/, "Travel & Transport"], [/kirana|provision|dairy|grocer|supermart/, "Groceries"],
  [/restaurant|cafe|sweets|bakery|dhaba|biryani|foods/, "Food & Dining"], [/salon|parlour|parlor/, "Personal Care"],
];

const BUSINESS_HINT = /\b(store|stores|shop|centre|center|traders?|agency|agencies|services?|solutions|enterprises?|pvt|ltd|llp|mart|bazaar|corner|point|house|world|hub|co)\b|\d|@(?!ok|ybl|ibl|axl|upi|apl|paytm\b)/i;

/** Two-to-four plain words with no shop-like hint ("PRADEEP KUMAR") is probably a person, not a merchant. */
export function looksLikePerson(payee: string, vpa = "") {
  if (/^(paytmqr|bharatpe|q\d|gpay-|bqr|mab\.|yesbankqr)/i.test(vpa)) return false; // shop QR codes
  const parts = payee.trim().split(/\s+/);
  return parts.length >= 2 && parts.length <= 4 && !BUSINESS_HINT.test(payee) && !keywordCategory(payee, vpa);
}

/** Up to three one-tap answers for the notification, best guess first. */
export function suggestionsFor({ amount, person, guess, method = "" }: { amount: number; person: boolean; guess?: string; method?: string }): Suggestion[] {
  const list: Suggestion[] = [];
  const add = (label: string, category: string) => { if (!list.some((s) => s.category === category) && list.length < 2) list.push({ label, kind: "expense", category }); };
  if (method === "ATM") return [{ label: "Cash spends", kind: "expense", category: "Other" }, { label: "Not spending", kind: "transfer" }];
  if (guess) add(shortLabel(guess), guess);
  if (amount <= 60) { add("Chai / snacks", "Food & Dining"); add("Auto / travel", "Travel & Transport"); }
  else if (amount <= 400) { add("Food", "Food & Dining"); add("Groceries", "Groceries"); }
  else { add("Groceries", "Groceries"); add("Shopping", "Shopping"); }
  // People are often paid back or lent money rather than paid for something, so "Not spending" always makes the cut.
  list.push({ label: person ? "Paid back / lent" : "Not spending", kind: "transfer" });
  return list;
}

export function shortLabel(category: string) {
  return ({ "Food & Dining": "Food", "Travel & Transport": "Travel", "Bills & Utilities": "Bills", "Business Expense": "Business", "Personal Care": "Personal care", "EMI / Loan": "EMI / loan" } as Record<string, string>)[category] ?? category;
}
