/* ---------------------------------------------------------------------------
 * Provider keys, encrypted at rest by the OS.
 *
 * The crypto is Electron's `safeStorage` (DPAPI on Windows, Keychain on macOS),
 * which only exists in the main process — so this asks that process over a
 * loopback endpoint it opened at launch, authenticated with a per-launch token.
 *
 * WITHOUT ELECTRON (npm run dev, or a test) there is no endpoint, and every
 * function below is a pass-through: values stay plaintext, exactly as they were
 * before this existed. That is the honest degradation, and the settings panel
 * says which mode is in effect.
 * ------------------------------------------------------------------------- */

const PREFIX = 'enc:v1:';

const url = () => (process.env.SANCTORUM_SECRETS_URL ?? '').trim();
const token = () => (process.env.SANCTORUM_SECRETS_TOKEN ?? '').trim();

/** True when the main process is reachable and OS encryption is available. */
export const secretsAvailable = (): boolean => Boolean(url() && token());

async function call(op: 'encrypt' | 'decrypt', value: string): Promise<string> {
  if (!secretsAvailable() || !value) return value;
  try {
    const res = await fetch(`${url()}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-secrets-token': token() },
      body: JSON.stringify({ op, value }),
    });
    if (!res.ok) return value;
    const data = (await res.json()) as { value?: string };
    return typeof data.value === 'string' ? data.value : value;
  } catch {
    // A key that cannot be decrypted must not take the run down with it; the
    // caller sees the stored value and the provider reports a bad key.
    return value;
  }
}

export const encryptSecret = (plain: string): Promise<string> =>
  plain && !plain.startsWith(PREFIX) ? call('encrypt', plain) : Promise.resolve(plain);

/** A value without the prefix was written before this existed — return it. */
export const decryptSecret = (stored: string): Promise<string> =>
  stored.startsWith(PREFIX) ? call('decrypt', stored) : Promise.resolve(stored);

export const isEncrypted = (value: string): boolean => value.startsWith(PREFIX);

/** Last 4 of the PLAINTEXT, for the UI's "…a1b2" hint. */
export async function keyHint(stored: string): Promise<string> {
  if (!stored) return '';
  const plain = await decryptSecret(stored);
  return plain ? `…${plain.slice(-4)}` : '…••••';
}
