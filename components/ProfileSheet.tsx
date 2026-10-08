"use client";

import { FormEvent, useEffect, useState } from "react";
import RecoveryCodeCard from "@/components/RecoveryCodeCard";
import SmsSettings from "@/components/SmsSettings";
import { api } from "@/lib/api-client";
import { displayAddress } from "@/lib/nudges";

type User = { id: string; name: string; email: string; nickname: string; isAdmin?: boolean };
type MoneyMode = "savings" | "investments";
type Panel = "password" | "email" | "recovery" | "delete" | "admin" | null;
type AdminLink = { name: string; link: string; expiresAt: string };

export default function ProfileSheet(props: {
  user: User; onUserChange: (user: User) => void; busy: boolean; onSignOut: () => void; notify: (message: string) => void;
  roastsEnabled: boolean; onRoastsEnabled: (value: boolean) => void; moneyMode: MoneyMode; onMoneyMode: (value: MoneyMode) => void;
  customCategories: string[]; onCustomCategories: (value: string[]) => void;
}) {
  const { user, onUserChange, busy, onSignOut, notify, roastsEnabled, onRoastsEnabled, moneyMode, onMoneyMode, customCategories, onCustomCategories } = props;
  const [name, setName] = useState(user.name);
  const [nickname, setNickname] = useState(user.nickname);
  const [panel, setPanel] = useState<Panel>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<{ hasCode: boolean; createdAt: string | null } | null>(null);
  const [newCode, setNewCode] = useState("");
  const [adminLink, setAdminLink] = useState<AdminLink | null>(null);
  const profileChanged = name.trim() !== user.name || nickname.trim() !== user.nickname;

  useEffect(() => {
    let cancelled = false;
    api<{ hasCode: boolean; createdAt: string | null }>("/api/account/recovery-code").then((r) => { if (!cancelled) setRecovery(r); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function run(key: string, task: () => Promise<void>) {
    if (working) return;
    setWorking(key); setError("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setWorking(""); }
  }

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    void run("profile", async () => {
      const result = await api<{ user: User }>("/api/account", { method: "PATCH", body: JSON.stringify({ name: name.trim(), nickname: nickname.trim() }) });
      onUserChange({ ...user, ...result.user }); setName(result.user.name); setNickname(result.user.nickname);
      notify("Profile saved");
    });
  }

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), target = event.currentTarget;
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) { setError("New passwords don't match"); return; }
    void run("password", async () => {
      const result = await api<{ signedOut: number }>("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword }) });
      target.reset(); setPanel(null);
      notify(result.signedOut ? `Password changed · ${result.signedOut} other device${result.signedOut === 1 ? "" : "s"} signed out` : "Password changed");
    });
  }

  function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("email", async () => {
      const result = await api<{ email: string }>("/api/account/email", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      onUserChange({ ...user, email: result.email }); setPanel(null);
      notify("Email updated");
    });
  }

  function signOutOthers() {
    void run("sessions", async () => {
      const result = await api<{ signedOut: number }>("/api/account/sessions", { method: "DELETE" });
      notify(result.signedOut ? `Signed out ${result.signedOut} other device${result.signedOut === 1 ? "" : "s"}` : "No other devices were signed in");
    });
  }

  function removeCategory(category: string) {
    void run(`category:${category}`, async () => {
      const result = await api<{ customExpenseCategories: string[] }>("/api/preferences", {
        method: "PATCH", body: JSON.stringify({ customExpenseCategories: customCategories.filter((item) => item !== category) }),
      });
      onCustomCategories(result.customExpenseCategories);
      notify(`Removed “${category}”. Past expenses keep it.`);
    });
  }

  function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("delete", async () => {
      await api("/api/account", { method: "DELETE", body: JSON.stringify({ password: form.get("password") }) });
      window.location.assign("/register");
    });
  }

  function createRecoveryCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("recovery", async () => {
      const result = await api<{ recoveryCode: string; createdAt: string }>("/api/account/recovery-code", { method: "POST", body: JSON.stringify({ password: form.get("password") }) });
      setNewCode(result.recoveryCode); setRecovery({ hasCode: true, createdAt: result.createdAt });
    });
  }

  function createAdminLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("admin", async () => {
      setAdminLink(await api<AdminLink>("/api/admin/reset-link", { method: "POST", body: JSON.stringify({ email: form.get("email") }) }));
    });
  }

  async function shareAdminLink(link: AdminLink, via: "whatsapp" | "copy") {
    const text = `Hi ${link.name.split(/\s+/)[0]}, here's your Flow password reset link. It works once and expires in 24 hours:\n${link.link}`;
    // Plain navigation: in the Android app, Flow hands non-Flow links to WhatsApp / the browser.
    if (via === "whatsapp") { window.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`; return; }
    try { await navigator.clipboard.writeText(text); notify("Reset message copied"); } catch { notify("Couldn't copy. Select the link and copy it"); }
  }

  function toggle(next: Panel) { setPanel((current) => (current === next ? null : next)); setError(""); setNewCode(""); }

  return <div className="profile-sheet">
    <h2>Profile</h2>
    <div className="profile-card">
      <span className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
      <div><strong>{user.name}</strong><small>{user.email}</small></div>
    </div>
    {error && <div className="auth-error profile-error" role="alert">{error}</div>}

    <section className="profile-section">
      <h3>About you</h3>
      <form className="form-stack" onSubmit={saveProfile}>
        <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} autoComplete="name" required /></label>
        <label>What should Flow call you?
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} placeholder={displayAddress("", name)} />
          <small className="field-hint">Used in greetings, roasts and reminders. Leave blank to use your first name.</small>
        </label>
        {profileChanged && <button className="primary-save" disabled={working === "profile"}>{working === "profile" ? "Saving…" : "Save profile"}</button>}
      </form>
    </section>

    <section className="profile-section">
      <h3>Preferences</h3>
      <div className="profile-row">
        <div><strong>Funny roasts</strong><small>Roast pop-ups and overspend reminders. Off keeps only praise and plain insights.</small></div>
        <button type="button" role="switch" aria-checked={roastsEnabled} aria-label="Funny roasts" className={`switch ${roastsEnabled ? "on" : ""}`} onClick={() => onRoastsEnabled(!roastsEnabled)}><span /></button>
      </div>
      <div className="profile-row">
        <div><strong>Second tab shows</strong><small>Pick what you track besides expenses.</small></div>
        <div className="segmented" role="radiogroup" aria-label="Second tab">
          <button type="button" role="radio" aria-checked={moneyMode === "savings"} className={moneyMode === "savings" ? "active" : ""} onClick={() => onMoneyMode("savings")}>Savings</button>
          <button type="button" role="radio" aria-checked={moneyMode === "investments"} className={moneyMode === "investments" ? "active" : ""} onClick={() => onMoneyMode("investments")}>Investments</button>
        </div>
      </div>
      {customCategories.length > 0 && <div className="profile-row profile-row-stack">
        <div><strong>Your categories</strong><small>Remove ones you no longer use. Existing expenses are not changed.</small></div>
        <div className="profile-chips">{customCategories.map((category) =>
          <span key={category}>{category}<button type="button" aria-label={`Remove ${category}`} disabled={working === `category:${category}`} onClick={() => removeCategory(category)}>×</button></span>)}
        </div>
      </div>}
    </section>

    <SmsSettings notify={notify} />

    <section className="profile-section">
      <h3>Security</h3>
      <button type="button" className="profile-link" aria-expanded={panel === "password"} onClick={() => toggle("password")}>Change password<span>{panel === "password" ? "−" : "›"}</span></button>
      {panel === "password" && <form className="form-stack profile-panel" onSubmit={changePassword}>
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
        <small className="field-hint">Other phones and browsers will be signed out. This one stays signed in.</small>
        <button className="primary-save" disabled={working === "password"}>{working === "password" ? "Updating…" : "Update password"}</button>
      </form>}
      <button type="button" className="profile-link" aria-expanded={panel === "email"} onClick={() => toggle("email")}>Change email<span>{panel === "email" ? "−" : "›"}</span></button>
      {panel === "email" && <form className="form-stack profile-panel" onSubmit={changeEmail}>
        <label>New email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="primary-save" disabled={working === "email"}>{working === "email" ? "Updating…" : "Update email"}</button>
      </form>}
      <button type="button" className="profile-link" aria-expanded={panel === "recovery"} onClick={() => toggle("recovery")}>
        <span className="profile-link-label">Recovery code
          <small className={recovery && !recovery.hasCode ? "warn" : ""}>{!recovery ? "" : recovery.hasCode ? `Saved ${new Date(recovery.createdAt ?? "").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "Not set up. Create one so you can reset a forgotten password"}</small>
        </span><span>{panel === "recovery" ? "−" : "›"}</span>
      </button>
      {panel === "recovery" && (newCode ? <div className="profile-panel"><RecoveryCodeCard code={newCode} /></div>
        : <form className="form-stack profile-panel" onSubmit={createRecoveryCode}>
          <p className="sheet-copy">If you forget your password, enter your email and this code on the sign-in screen. {recovery?.hasCode ? "Creating a new code makes your old one stop working." : ""}</p>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button className="primary-save" disabled={working === "recovery"}>{working === "recovery" ? "Creating…" : recovery?.hasCode ? "Create a new code" : "Create recovery code"}</button>
        </form>)}
      <button type="button" className="profile-link" onClick={signOutOthers} disabled={working === "sessions"}>{working === "sessions" ? "Signing out…" : "Sign out of other devices"}<span>›</span></button>
    </section>

    {user.isAdmin && <section className="profile-section">
      <h3>Admin</h3>
      <button type="button" className="profile-link" aria-expanded={panel === "admin"} onClick={() => { toggle("admin"); setAdminLink(null); }}>Reset someone&apos;s password<span>{panel === "admin" ? "−" : "›"}</span></button>
      {panel === "admin" && (adminLink ? <div className="form-stack profile-panel">
        <p className="sheet-copy">Reset link for <strong>{adminLink.name}</strong>. It works once and expires in 24 hours. Only send it to them directly.</p>
        <input readOnly value={adminLink.link} onFocus={(e) => e.currentTarget.select()} aria-label="Reset link" />
        <div className="form-two">
          <button type="button" className="primary-save" onClick={() => void shareAdminLink(adminLink, "whatsapp")}>Send on WhatsApp</button>
          <button type="button" className="profile-link" onClick={() => void shareAdminLink(adminLink, "copy")}>Copy message</button>
        </div>
        <button type="button" className="danger-button" onClick={() => setAdminLink(null)}>Reset another account</button>
      </div>
        : <form className="form-stack profile-panel" onSubmit={createAdminLink}>
          <p className="sheet-copy">For someone who forgot their password and has no recovery code. Flow makes a one-time link you send them yourself. Making a new link cancels older ones.</p>
          <label>Their Flow email<input name="email" type="email" autoComplete="off" required /></label>
          <button className="primary-save" disabled={working === "admin"}>{working === "admin" ? "Creating…" : "Create reset link"}</button>
        </form>)}
    </section>}

    <section className="profile-section">
      <h3>Your data</h3>
      <a className="profile-link" href="/api/export">Export all data as CSV<span>⇩</span></a>
      <button type="button" className="profile-link danger" aria-expanded={panel === "delete"} onClick={() => toggle("delete")}>Delete account<span>{panel === "delete" ? "−" : "›"}</span></button>
      {panel === "delete" && <form className="form-stack profile-panel" onSubmit={deleteAccount}>
        <p className="sheet-copy">This permanently deletes your account, expenses, budgets, savings and investments. Export first if you want a copy. It can&apos;t be undone.</p>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="danger-solid" disabled={working === "delete"}>{working === "delete" ? "Deleting…" : "Delete my account forever"}</button>
      </form>}
    </section>

    <button className="danger-button profile-signout" onClick={onSignOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
  </div>;
}
