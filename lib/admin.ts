// Flow admins (who can create reset links for other people) are listed by email in ADMIN_EMAILS, comma-separated.
export function isAdminEmail(email: string) {
  const admins = (process.env.ADMIN_EMAILS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

/** Email reset links stay in the code for later; they only show in the app when PASSWORD_RESET_EMAIL=on. */
export function emailResetEnabled() {
  return (process.env.PASSWORD_RESET_EMAIL || "").trim().toLowerCase() === "on";
}
