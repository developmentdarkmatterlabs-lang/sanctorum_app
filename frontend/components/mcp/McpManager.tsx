import { useEffect, useState } from 'react';
import type { McpServer } from '@/lib/office/types';
import type { McpServerInput } from '@/api/mcp';

type McpManagerProps = {
  open: boolean;
  servers: McpServer[];
  onClose: () => void;
  onCreate: (input: McpServerInput) => Promise<unknown>;
  onUpdate: (id: string, input: Partial<McpServerInput>) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
};

type Draft = {
  name: string;
  description: string;
  transport: 'http' | 'stdio';
  url: string;
  authToken: string; // raw; blank = leave unchanged on edit
  headers: string;
  command: string;
  args: string;
  minClearance: number;
  enabled: boolean;
};

const EMPTY: Draft = {
  name: '',
  description: '',
  transport: 'http',
  url: '',
  authToken: '',
  headers: '',
  command: '',
  args: '',
  minClearance: 0,
  enabled: true,
};

const field =
  'w-full rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-1.5 font-mono text-[12px] text-[var(--content-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]';
const label = 'font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]';

/** The MCP server library: register / edit / delete external MCP servers.
 *  HTTP-first (URL + masked auth token); stdio (command/args) is advanced.
 *  Assignment to a seat happens in the dossier (McpAssign), not here. */
export default function McpManager({
  open,
  servers,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: McpManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = servers.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setDraft({
        name: selected.name,
        description: selected.description,
        transport: selected.transport,
        url: selected.url,
        authToken: '', // never prefill the raw token; blank = keep existing
        headers: selected.headers,
        command: selected.command,
        args: selected.args,
        minClearance: selected.minClearance,
        enabled: selected.enabled,
      });
    } else {
      setDraft(EMPTY);
    }
    setError(null);
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  const valid =
    draft.name.trim() &&
    (draft.transport === 'http' ? draft.url.trim() : draft.command.trim());

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      // On edit, only send authToken if the user typed a new one (blank = keep).
      const input: McpServerInput = {
        name: draft.name.trim(),
        description: draft.description,
        transport: draft.transport,
        url: draft.url,
        headers: draft.headers,
        command: draft.command,
        args: draft.args,
        minClearance: draft.minClearance,
        enabled: draft.enabled,
        ...(draft.authToken ? { authToken: draft.authToken } : selected ? {} : { authToken: '' }),
      };
      if (selected) await onUpdate(selected.id, input);
      else {
        await onCreate(input);
        setDraft(EMPTY);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(selected.id);
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[600px] max-h-full w-[760px] max-w-full overflow-hidden rounded-md border border-[var(--border-primary)] bg-[var(--surface-secondary)] shadow-2xl">
        {/* Library list */}
        <div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--border-primary)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              MCP servers
            </span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15"
            >
              + new
            </button>
          </div>
          <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {servers.length === 0 ? (
              <li className="m-auto px-4 py-8 text-center font-mono text-[10px] leading-relaxed text-[var(--content-tertiary)]">
                No servers yet. Register one to give agents its tools.
              </li>
            ) : (
              servers.map((s) => (
                <li key={s.id} className="border-b border-[var(--border-primary)]">
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--surface-tertiary)] ${
                      selectedId === s.id ? 'bg-[var(--surface-tertiary)]' : ''
                    }`}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="truncate font-mono text-[12px] text-[var(--content-primary)]">
                        {s.name}
                      </span>
                      {!s.enabled && (
                        <span className="ml-auto font-mono text-[9px] text-[var(--content-tertiary)]">
                          off
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--content-tertiary)]">
                      {s.transport}
                      {s.minClearance > 0 ? ` · clr ${s.minClearance}` : ''}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--content-secondary)]">
              {selected ? 'Edit server' : 'Register server'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto cursor-pointer rounded border border-[var(--border-primary)] px-2 py-[3px] font-mono text-[10px] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            >
              close
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <div className="flex flex-col gap-1">
              <span className={label}>Name</span>
              <input
                className={field}
                value={draft.name}
                spellCheck={false}
                placeholder="e.g. office-mcp"
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={label}>Description</span>
              <input
                className={field}
                value={draft.description}
                placeholder="What tools it provides"
                onChange={(e) => set('description', e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <span className={label}>Transport</span>
                <select
                  className={field}
                  value={draft.transport}
                  onChange={(e) => set('transport', e.target.value as 'http' | 'stdio')}
                >
                  <option value="http">http (remote)</option>
                  <option value="stdio">stdio (local, advanced)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className={label}>Min clearance</span>
                <input
                  type="number"
                  min={0}
                  max={8}
                  className={`${field} w-20`}
                  value={draft.minClearance}
                  onChange={(e) => set('minClearance', Number(e.target.value) || 0)}
                />
              </div>
              <label className="mt-4 flex cursor-pointer items-center gap-2 font-mono text-[10px] text-[var(--content-secondary)]">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => set('enabled', e.target.checked)}
                  className="accent-[var(--accent-primary)]"
                />
                enabled
              </label>
            </div>

            {draft.transport === 'http' ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className={label}>Server URL</span>
                  <input
                    className={field}
                    value={draft.url}
                    spellCheck={false}
                    placeholder="https://mcp.example.com/office"
                    onChange={(e) => set('url', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                    Auth token
                    {selected?.auth.set ? (
                      <span className="text-[var(--accent-primary)]">set {selected.auth.hint}</span>
                    ) : (
                      <span>not set</span>
                    )}
                  </span>
                  <input
                    type="password"
                    className={field}
                    value={draft.authToken}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={
                      selected?.auth.set ? 'Enter a new token to replace…' : 'Bearer token (optional)'
                    }
                    onChange={(e) => set('authToken', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className={label}>Extra headers (JSON, optional)</span>
                  <input
                    className={field}
                    value={draft.headers}
                    spellCheck={false}
                    placeholder='{"X-Client":"sanctorum"}'
                    onChange={(e) => set('headers', e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <span className={label}>Command</span>
                  <input
                    className={field}
                    value={draft.command}
                    spellCheck={false}
                    placeholder="npx"
                    onChange={(e) => set('command', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className={label}>Args (JSON array)</span>
                  <input
                    className={field}
                    value={draft.args}
                    spellCheck={false}
                    placeholder='["-y","@some/mcp-server"]'
                    onChange={(e) => set('args', e.target.value)}
                  />
                </div>
              </>
            )}

            <p className="font-mono text-[9.5px] leading-relaxed text-[var(--content-tertiary)]">
              Tokens are stored locally, unencrypted, and never shown again.
            </p>

            {error && (
              <p
                role="alert"
                className="rounded border border-[var(--semantic-error-muted)] px-2 py-1.5 font-mono text-[10px] text-[var(--semantic-error)]"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-primary)] p-2.5">
            {selected && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="cursor-pointer rounded border border-[var(--semantic-error)] px-3 py-1.5 font-mono text-[10px] text-[var(--semantic-error)] hover:bg-[var(--semantic-error)]/15 disabled:opacity-40"
              >
                delete
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !valid}
              className="ml-auto cursor-pointer rounded border border-[var(--accent-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '…' : selected ? 'save changes' : 'register server'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
