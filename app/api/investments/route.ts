import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { rupeesToPaise } from "@/lib/money";
import { serializeInvestment } from "@/lib/serializers";
import { investmentSchema } from "@/lib/validators";
import { Investment } from "@/models/Investment";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    await dbConnect();
    const docs = await Investment.find({ userId: user.id }).sort({ dateKey: -1, createdAt: -1 }).limit(1000).lean();
    return NextResponse.json({ investments: docs.map((d) => serializeInvestment(d as never)) });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = investmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Please check the investment details");
    await dbConnect();
    const doc = await Investment.create({
      userId: user.id, name: parsed.data.name, type: parsed.data.type,
      investedPaise: rupeesToPaise(parsed.data.invested), currentPaise: rupeesToPaise(parsed.data.current),
      dateKey: parsed.data.date, frequency: parsed.data.frequency, rate: parsed.data.rate,
      platform: parsed.data.platform, maturityKey: parsed.data.maturity, note: parsed.data.note,
    });
    return NextResponse.json({ investment: serializeInvestment(doc.toObject()) }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
