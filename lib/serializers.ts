import { paiseToRupees } from "@/lib/money";

export function serializeExpense(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    amount: paiseToRupees(Number(doc.amountPaise)),
    category: String(doc.category ?? ""),
    date: String(doc.dateKey ?? ""),
    name: String(doc.name ?? ""),
    payment: String(doc.payment ?? ""),
    type: String(doc.type ?? ""),
    recurring: String(doc.recurring ?? ""),
    extra: String(doc.extra ?? ""),
  };
}

export function serializeInvestment(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    type: String(doc.type ?? ""),
    invested: paiseToRupees(Number(doc.investedPaise)),
    current: paiseToRupees(Number(doc.currentPaise)),
    date: String(doc.dateKey ?? ""),
    frequency: String(doc.frequency ?? ""),
    rate: doc.rate == null ? null : Number(doc.rate),
    platform: String(doc.platform ?? ""),
    maturity: String(doc.maturityKey ?? ""),
    note: String(doc.note ?? ""),
  };
}
