"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import RecoveryCodeCard from "@/components/RecoveryCodeCard";

type Method = "code" | "email";

// "request": forgot password, by recovery code (always) or emailed link (only when emailEnabled).
// "reset": choose a new password from a one-time link (emailed, or sent by the Flow admin).
export default function PasswordResetForm({ mode, token = "", emailEnabled = false }: { mode: "request" | "reset"; token?: string; emailEnabled?: boolean }) {
  const [method, setMethod] = useState<Method>("code");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [newCode, setNewCode] = useState("");

  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong");
    return data as { recoveryCode?: string };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const choosingPassword = mode === "reset" || method === "code";
    if (choosingPassword && form.get("password") !== form.get("confirm")) { setError("Passwords don't match"); return; }
    setBusy(true); setError("");
    try {
      if (mode === "reset") {
        await post("/api/auth/reset", { token, password: form.get("password") });
        window.location.assign("/dashboard");
        return;
      }
      if (method === "email") {
        await post("/api/auth/forgot", { email: form.get("email") });
        setSent(true);
      } else {
        const data = await post("/api/auth/recover", { email: form.get("email"), code: form.get("code"), password: form.get("password") });
        setNewCode(data.recoveryCode ?? "");
      }
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  const missingToken = mode === "reset" && !token;
  const title = mode === "reset" ? "Choose a new password" : newCode ? "You're back in" : "Reset password";
  const copy = mode === "reset" ? "You'll be signed out on every other device once it's changed."
    : newCode ? "Your password is changed. Your old recovery code no longer works, so save this new one."
    : method === "code" ? "Use the recovery code you saved from your Flow profile." : "We'll email you a link to set a new password.";

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-mark">Flow</div>
        <p className="auth-kicker">Personal money, kept simple.</p>
        <h1>{title}</h1>
        <p className="auth-copy">{copy}</p>
        {mode === "request" && emailEnabled && !newCode && !sent && <div className="segmented auth-methods" role="radiogroup" aria-label="How to reset">
          <button type="button" role="radio" aria-checked={method === "code"} className={method === "code" ? "active" : ""} onClick={() => { setMethod("code"); setError(""); }}>Recovery code</button>
          <button type="button" role="radio" aria-checked={method === "email"} className={method === "email" ? "active" : ""} onClick={() => { setMethod("email"); setError(""); }}>Email link</button>
        </div>}

        {missingToken ? <div className="auth-error" role="alert">This reset link is incomplete. Open the full link again, or ask the Flow admin for a new one.</div>
          : newCode ? <div className="auth-form">
            <RecoveryCodeCard code={newCode} />
            <button type="button" className="auth-submit" onClick={() => window.location.assign("/dashboard")}>I&apos;ve saved it, continue</button>
          </div>
          : sent ? <div className="auth-success" role="status">If an account exists for that email, a reset link is on its way. It expires in 30 minutes, so check your inbox (and spam) soon.</div>
          : <form onSubmit={submit} className="auth-form">
            {mode === "request" && <label>Email<input name="email" type="email" autoComplete="email" required autoFocus /></label>}
            {mode === "request" && method === "code" && <label>Recovery code<input name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="FLOW-XXXX-XXXX-XXXX" required minLength={8} maxLength={40} /></label>}
            {(mode === "reset" || method === "code") && <>
              <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} autoFocus={mode === "reset"} /></label>
              <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} /></label>
            </>}
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "request" && method === "email" ? "Send reset link" : "Save new password"}</button>
          </form>}

        {mode === "request" && method === "code" && !newCode && <p className="auth-help">No recovery code? Ask the Flow admin to send you a reset link.</p>}
        <div className="auth-switch">
          {newCode ? null : mode === "reset" && (missingToken || error) ? <Link href="/forgot-password">Use a recovery code instead</Link> : <>Remembered it? <Link href="/login">Sign in</Link></>}
        </div>
      </section>
    </main>
  );
}
