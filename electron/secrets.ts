import { safeStorage } from 'electron';

/* ---------------------------------------------------------------------------
 * Provider keys, encrypted at rest by the OS.
 *
 * safeStorage wraps DPAPI on Windows and the Keychain on macOS: the ciphertext
 * is bound to the logged-in user, so another account on the same machine — and
 * anything that reads the profile without being that user — gets nothing.
 *
 * WHY THIS LIVES IN THE MAIN PROCESS. safeStorage is an Electron API and the
 * backend is a plain Node child. So the main process owns the crypto and the
 * backend asks for it, the same way it already receives DATABASE_URL.
 *
 * NOT a substitute for a real secrets manager. It stops a file read; it does
 * not stop a process running AS the user, which can always ask the OS to
 * decrypt. For a single-user desktop app that is the right boundary.
 * ------------------------------------------------------------------------- */

/** Marks a value this module produced. Anything without it is legacy plaintext,
 *  which is what makes the migration invisible: old keys keep working. */
const PREFIX = 'enc:v1:';

/** False on a Linux box with no keyring, where encryption silently degrades. */
export function available(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Encrypt a value for storage. Returns it unchanged when unavailable, so a
 *  missing keyring degrades to today's behaviour rather than losing the key. */
export function encrypt(plain: string): string {
  if (!plain || !available() || plain.startsWith(PREFIX)) return plain;
  try {
    return PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

/** Decrypt a stored value. A value without the prefix is returned as-is — that
 *  is a key written before this existed, and it must keep working. */
export function decrypt(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  if (!available()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
  } catch {
    // Wrong user, or a profile copied to another machine. Returning '' reads as
    // "no key set", which the UI already handles.
    return '';
  }
}

export const isEncrypted = (value: string): boolean => value.startsWith(PREFIX);
