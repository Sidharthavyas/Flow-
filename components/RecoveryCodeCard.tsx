"use client";

import { useState } from "react";

// Shows a freshly created recovery code once, with copy and share, and tells the user how to keep it.
export default function RecoveryCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const text = `My Flow recovery code: ${code}\nUse it at Flow → Sign in → Forgot password. Keep it private.`;

  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: the code is still selectable */ }
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ text }); else await copy(); } catch { /* share sheet cancelled */ }
  }

  return <div className="recovery-card" role="status">
    <small>Your recovery code</small>
    <code>{code}</code>
    <div className="recovery-actions">
      <button type="button" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy"}</button>
      <button type="button" onClick={() => void share()}>Save / share</button>
    </div>
    <p>Save it somewhere only you can see, like a screenshot or WhatsApp &ldquo;Message yourself&rdquo;. It&apos;s shown only once and works once. Anyone with this code and your email can reset your password.</p>
  </div>;
}
