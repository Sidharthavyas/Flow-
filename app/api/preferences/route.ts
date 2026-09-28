import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { preferencesSchema } from "@/lib/validators";
import { User } from "@/models/User";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    await dbConnect();
    const doc = await User.findById(user.id).select("moneyMode customExpenseCategories").lean();
    if (!doc) return jsonError("Unauthorized", 401);
    return NextResponse.json({
      moneyMode: doc.moneyMode === "savings" || doc.moneyMode === "investments" ? doc.moneyMode : null,
      customExpenseCategories: Array.isArray(doc.customExpenseCategories) ? doc.customExpenseCategories.map(String) : [],
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}

export async function PATCH(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = preferencesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Please check your preferences");

    const update: Record<string, unknown> = {};
    if (parsed.data.moneyMode) update.moneyMode = parsed.data.moneyMode;
    if (parsed.data.customExpenseCategories) {
      const seen = new Set<string>();
      update.customExpenseCategories = parsed.data.customExpenseCategories
        .map((item) => item.trim())
        .filter((item) => {
          const key = item.toLocaleLowerCase();
          if (!item || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 40);
    }

    await dbConnect();
    const doc = await User.findByIdAndUpdate(user.id, update, { new: true, runValidators: true }).select("moneyMode customExpenseCategories").lean();
    if (!doc) return jsonError("Unauthorized", 401);
    return NextResponse.json({
      moneyMode: doc.moneyMode === "savings" || doc.moneyMode === "investments" ? doc.moneyMode : null,
      customExpenseCategories: Array.isArray(doc.customExpenseCategories) ? doc.customExpenseCategories.map(String) : [],
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
