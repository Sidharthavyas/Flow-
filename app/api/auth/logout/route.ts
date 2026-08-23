import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { isTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return jsonError("Invalid request origin", 403);
  await destroySession();
  return NextResponse.json({ ok: true });
}
