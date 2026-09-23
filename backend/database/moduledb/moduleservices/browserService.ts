import { prisma } from '../../db';

/**
 * The agent's browser — a thin forwarder to the Electron main process.
 *
 * No browser logic lives here. The page is a WebContentsView owned by the main
 * process (Electron already ships Chromium; bundling Playwright would ship a
 * second one), so this validates the run, then asks over the loopback bridge —
 * the same shape `delegate` uses to call back into Node.
 *
 * Returns a STRING for the model, like every other tool: a refusal is a normal
 * result the agent must adapt to, never an exception.
 */

const url = () => (process.env.SANCTORUM_SECRETS_URL ?? '').trim();
const token = () => (process.env.SANCTORUM_SECRETS_TOKEN ?? '').trim();

export const browserAvailable = (): boolean => Boolean(url() && token());

type Reply = { ok?: boolean; text?: string; url?: string; error?: string };

async function ask(body: Record<string, unknown>): Promise<Reply> {
  const res = await fetch(`${url()}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-secrets-token': token() },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Reply;
}

export type BrowserAction = 'browse' | 'click' | 'type' | 'scroll' | 'back' | 'read';

export async function browserAction(
  runId: string,
  action: BrowserAction,
  args: { url?: string; index?: number; text?: string; amount?: number }
): Promise<string> {
  if (!browserAvailable()) {
    return 'error: the browser is only available in the desktop app.';
  }

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { agentKey: true, status: true },
  });
  if (!run) return 'error: this run is unknown.';
  if (run.status === 'cancelled') return 'error: this run was cancelled.';

  try {
    const reply =
      action === 'browse'
        ? await ask({ op: 'browse', runId, agentKey: run.agentKey ?? '', url: args.url ?? '' })
        : await ask({ op: 'act', runId, action, ...args });

    if (!reply.ok) return `error: ${reply.error ?? 'the action failed'}`;
    return reply.text ?? '';
  } catch (err) {
    return `error: the browser did not respond: ${(err as Error).message}`;
  }
}

/** Closes a run's page. Called when the run ends — a leaked view outlives it. */
export async function closeBrowser(runId: string): Promise<void> {
  if (!browserAvailable()) return;
  await ask({ op: 'close', runId }).catch(() => undefined);
}
