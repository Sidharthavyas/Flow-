import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiRoast } from "@/lib/ai-roast";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { User } from "@/models/User";

export const runtime = "nodejs";

// AI-written roast for one just-added expense. Returns { line: null } when no AI provider is set up,
// and the app falls back to its own template.
const roastSchema = z.object({
  level: z.enum(["mild", "hot", "inferno"]),
  situation: z.string().max(60),
  amount: z.number().positive().max(1e9),
  category: z.string().max(80),
  description: z.string().max(120).optional(),
  typicalSpend: z.number().min(0).max(1e9).optional(),
  budget: z.number().min(0).max(1e10).optional(),
  spentAfter: z.number().min(0).max(1e10).optional(),
  time: z.string().max(20).optional(),
});

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = roastSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid roast request");
    await dbConnect();
    const address = String((await User.findById(user.id).select("roastAddress").lean())?.roastAddress ?? "yaar");
    const f = parsed.data, rupees = (v?: number) => (v === undefined ? undefined : `₹${Math.round(v)}`);
    const line = await aiRoast({
      level: f.level, addressAs: address, situation: `Just added an expense — ${f.situation}`, amount: rupees(f.amount), category: f.category,
      description: f.description, typicalSpend: rupees(f.typicalSpend), budget: rupees(f.budget), spentAfterThis: rupees(f.spentAfter), time: f.time,
    });
    return NextResponse.json({ line }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
