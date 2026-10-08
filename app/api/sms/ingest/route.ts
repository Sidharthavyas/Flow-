import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { dbConnect } from "@/lib/db";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { ingestSms } from "@/lib/sms/ingest";
import { smsIngestSchema } from "@/lib/validators";

export const runtime = "nodejs";

// Called by the Android app for each new bank SMS (using the app's login cookie). Returns what to show in the notification.
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  try {
    const user = await requireApiUser();
    const parsed = smsIngestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Invalid SMS");
    await dbConnect();
    const receivedAt = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date();
    const result = await ingestSms({ userId: user.id, userName: user.name, text: parsed.data.text, sender: parsed.data.sender, receivedAt });
    console.info(`SMS ingest for user ${user.id}: ${result.status}`);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    throw e;
  }
}
