import { NextRequest, NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function isTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return Boolean(forwardedHost && originHost === forwardedHost);
  } catch {
    return false;
  }
}
