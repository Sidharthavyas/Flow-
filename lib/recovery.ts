import { randomInt } from "node:crypto";
import { hash } from "bcryptjs";

// Recovery codes look like FLOW-7KQ2-M9XD-4TPA: 12 characters from an alphabet without look-alikes (0/O, 1/I/L),
// about 59 bits of randomness. Only a bcrypt hash is stored, and each code works once.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 12;

export const MAX_RECOVERY_FAILURES = 5;
export const RECOVERY_LOCK_MINUTES = 15;

export function generateRecoveryCode() {
  const raw = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `FLOW-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** Accepts the code however it was typed: any case, with or without the FLOW- prefix, dashes or spaces. */
export function normalizeRecoveryCode(input: string) {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.startsWith("FLOW") && compact.length === LENGTH + 4 ? compact.slice(4) : compact;
}

/** A fresh code plus the fields to store on the user. */
export async function newRecoveryCode() {
  const code = generateRecoveryCode();
  return {
    code,
    fields: { recoveryCodeHash: await hash(normalizeRecoveryCode(code), 10), recoveryCodeCreatedAt: new Date(), recoveryFailures: 0, recoveryLockedUntil: null },
  };
}
