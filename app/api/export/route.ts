import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { paiseToRupees } from "@/lib/money";
import { Budget } from "@/models/Budget";
import { Expense } from "@/models/Expense";
import { Investment } from "@/models/Investment";

export const runtime = "nodejs";

function cell(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET() {
  try {
    const user = await requireApiUser();
    await dbConnect();
    const [expenses, investments, budgets] = await Promise.all([
      Expense.find({ userId: user.id }).sort({ dateKey: -1 }).lean(),
      Investment.find({ userId: user.id }).sort({ dateKey: -1 }).lean(),
      Budget.find({ userId: user.id }).sort({ periodStart: -1 }).lean(),
    ]);
    const rows: unknown[][] = [["Section","Date/Period","Name","Type/Category","Amount","Current","Extra"]];
    expenses.forEach((e) => rows.push(["Expense", e.dateKey, e.name, e.category, paiseToRupees(Number(e.amountPaise)), "", e.payment || e.recurring || e.extra || ""]));
    investments.forEach((i) => rows.push(["Investment", i.dateKey, i.name, i.type, paiseToRupees(Number(i.investedPaise)), paiseToRupees(Number(i.currentPaise)), i.platform || i.frequency || ""]));
    budgets.forEach((b) => rows.push(["Budget", b.periodStart, "", b.periodType, paiseToRupees(Number(b.amountPaise)), "", ""]));
    const csv = rows.map((row) => row.map(cell).join(",")).join("\n");
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=flow-export.csv", "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw e;
  }
}
