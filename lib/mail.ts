// Transactional email through Resend's HTTP API (no SDK needed).
//   RESEND_API_KEY  API key from resend.com
//   EMAIL_FROM      verified sender, e.g. "Flow <no-reply@yourdomain.com>"
// Without them, sending is disabled; in development the message is printed to the server console instead.

export function mailEnabled() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendMail({ to, subject, text, html }: { to: string; subject: string; text: string; html: string }) {
  if (!mailEnabled()) {
    if (process.env.NODE_ENV !== "production") console.info(`[mail disabled] To: ${to}\nSubject: ${subject}\n\n${text}`);
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM!.trim(), to, subject, text, html }),
    });
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    if (!response.ok) console.warn(`Email failed: ${response.status} ${detail}`);
    else console.info(`Email accepted by Resend: ${detail}`); // {"id":"…"}, searchable in the Resend dashboard
    return response.ok;
  } catch (error) {
    console.warn("Email failed", error);
    return false;
  }
}

/** Base URL for links in emails. The configured URL wins so a spoofed Host header can't redirect reset links. */
export function appUrl(fallbackOrigin: string) {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || fallbackOrigin).trim().replace(/\/+$/, "");
}

export function escapeHtml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (c) => entities[c]);
}
