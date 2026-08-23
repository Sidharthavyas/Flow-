"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const body = mode === "register"
      ? { name: form.get("name"), email: form.get("email"), password: form.get("password") }
      : { email: form.get("email"), password: form.get("password") };
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong");
      window.location.assign("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-mark">Flow</div>
        <p className="auth-kicker">Personal money, kept simple.</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="auth-copy">{mode === "login" ? "Sign in to your private dashboard." : "Start with email and password. You can add other sign-in methods later."}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && <label>Name<input name="name" autoComplete="name" required minLength={2} maxLength={80} /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} /></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <div className="auth-switch">
          {mode === "login" ? <>New to Flow? <Link href="/register">Create account</Link></> : <>Already have an account? <Link href="/login">Sign in</Link></>}
        </div>
      </section>
    </main>
  );
}
