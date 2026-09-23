import { prisma } from '../../db';
import { effectiveClearanceOf } from './positionResolve';

// MCP servers (Phase 3.7) — a shared library of EXTERNAL MCP servers (sources of
// real tools: edit Office docs, query a DB, …), assigned to POSITIONS (seats).
// The seat's holder gets those servers' tools at run time, gated + supervised like
// every other tool. HTTP-first (url + authToken); stdio (command/args) is advanced.
//
// SECURITY: authToken is stored plaintext (local single-user app) and NEVER
// returned raw to the client — the read DTO masks it (…last4). Only the write path
// accepts a raw token; the raw value is read SERVER-SIDE (buildRunSpec) to pass
// into a run. Never logged. (At-rest encryption is a planned fast-follow.)

export type Transport = 'http' | 'stdio';

/** Masked view of the auth token for the UI. */
export type AuthStatus = { set: boolean; hint: string };

export type McpServerDTO = {
  id: string;
  name: string;
  description: string;
  transport: Transport;
  url: string;
  auth: AuthStatus; // masked — never the raw token
  headers: string; // JSON string (no secrets expected here) or ''
  command: string;
  args: string; // JSON array string or ''
  minClearance: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const mask = (raw: string): AuthStatus =>
  raw ? { set: true, hint: `…${raw.slice(-4)}` } : { set: false, hint: '' };

type McpRow = {
  id: string;
  name: string;
  description: string;
  transport: string;
  url: string;
  authToken: string;
  headers: string;
  command: string;
  args: string;
  minClearance: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const toDTO = (row: McpRow): McpServerDTO => ({
  id: row.id,
  name: row.name,
  description: row.description,
  transport: (row.transport as Transport) ?? 'http',
  url: row.url,
  auth: mask(row.authToken),
  headers: row.headers,
  command: row.command,
  args: row.args,
  minClearance: row.minClearance,
  enabled: row.enabled,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// ---- Library CRUD ---------------------------------------------------------

export async function listMcpServers(): Promise<McpServerDTO[]> {
  const rows = await prisma.mcpServer.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toDTO);
}

export type McpServerInput = {
  name?: string;
  description?: string;
  transport?: Transport;
  url?: string;
  authToken?: string; // raw; '' clears
  headers?: string;
  command?: string;
  args?: string;
  minClearance?: number;
  enabled?: boolean;
};

export type McpResult =
  | { ok: true; server: McpServerDTO }
  | { ok: false; error: string };

const clampClearance = (n: number | undefined): number =>
  n === undefined || Number.isNaN(n) ? 0 : Math.max(0, Math.min(8, Math.trunc(n)));

export async function createMcpServer(input: McpServerInput): Promise<McpResult> {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  const transport: Transport = input.transport === 'stdio' ? 'stdio' : 'http';
  if (transport === 'http' && !input.url?.trim()) {
    return { ok: false, error: 'an http server needs a URL' };
  }
  if (transport === 'stdio' && !input.command?.trim()) {
    return { ok: false, error: 'a stdio server needs a command' };
  }
  const clash = await prisma.mcpServer.findUnique({ where: { name } });
  if (clash) return { ok: false, error: `a server named "${name}" already exists` };

  const row = await prisma.mcpServer.create({
    data: {
      name,
      description: input.description?.trim() ?? '',
      transport,
      url: input.url?.trim() ?? '',
      authToken: input.authToken?.trim() ?? '',
      headers: input.headers?.trim() ?? '',
      command: input.command?.trim() ?? '',
      args: input.args?.trim() ?? '',
      minClearance: clampClearance(input.minClearance),
      enabled: input.enabled ?? true,
    },
  });
  return { ok: true, server: toDTO(row) };
}

export async function updateMcpServer(
  id: string,
  input: McpServerInput
): Promise<McpResult | { ok: false; notFound: true }> {
  const exists = await prisma.mcpServer.findUnique({ where: { id } });
  if (!exists) return { ok: false, notFound: true };

  const name = input.name?.trim();
  if (name && name !== exists.name) {
    const clash = await prisma.mcpServer.findUnique({ where: { name } });
    if (clash) return { ok: false, error: `a server named "${name}" already exists` };
  }

  const row = await prisma.mcpServer.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.transport ? { transport: input.transport } : {}),
      ...(input.url !== undefined ? { url: input.url.trim() } : {}),
      // authToken: '' clears, undefined leaves unchanged.
      ...(input.authToken !== undefined ? { authToken: input.authToken.trim() } : {}),
      ...(input.headers !== undefined ? { headers: input.headers.trim() } : {}),
      ...(input.command !== undefined ? { command: input.command.trim() } : {}),
      ...(input.args !== undefined ? { args: input.args.trim() } : {}),
      ...(input.minClearance !== undefined ? { minClearance: clampClearance(input.minClearance) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });
  return { ok: true, server: toDTO(row) };
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  const exists = await prisma.mcpServer.findUnique({ where: { id } });
  if (!exists) return false;
  // Assignments cascade (onDelete: Cascade).
  await prisma.mcpServer.delete({ where: { id } });
  return true;
}

// ---- Assignment (server <-> position) -------------------------------------

/** The servers a position holds (masked), for the assign UI. */
export async function mcpsForPosition(positionId: string): Promise<McpServerDTO[]> {
  const links = await prisma.positionMcp.findMany({
    where: { positionId },
    include: { mcpServer: true },
  });
  return links.map((l) => toDTO(l.mcpServer)).sort((a, b) => a.name.localeCompare(b.name));
}

export type AssignResult = { ok: true } | { ok: false; error: string };

/** Grant a server to a position. Refused if the seat's clearance is below the
 *  server's minClearance. Idempotent. */
export async function assignMcp(
  positionId: string,
  mcpServerId: string
): Promise<AssignResult> {
  const [position, server] = await Promise.all([
    // The role is needed to resolve an inherited clearance (Phase 3.9).
    prisma.position.findUnique({ where: { id: positionId }, include: { role: true } }),
    prisma.mcpServer.findUnique({ where: { id: mcpServerId } }),
  ]);
  if (!position) return { ok: false, error: 'position not found' };
  if (!server) return { ok: false, error: 'server not found' };
  const seatClearance = effectiveClearanceOf(position, position.role);
  if (seatClearance < server.minClearance) {
    return {
      ok: false,
      error: `this seat's clearance (${seatClearance}) is below the server's minimum (${server.minClearance})`,
    };
  }
  await prisma.positionMcp.upsert({
    where: { positionId_mcpServerId: { positionId, mcpServerId } },
    update: {},
    create: { positionId, mcpServerId },
  });
  return { ok: true };
}

export async function unassignMcp(positionId: string, mcpServerId: string): Promise<void> {
  await prisma.positionMcp.deleteMany({ where: { positionId, mcpServerId } });
}

// ---- Run-time (server-only: raw secrets) ----------------------------------

/** A server's config with the RAW token, to attach to a run. NEVER sent to the
 *  client. Disabled servers are omitted. */
export type McpServerConfig = {
  name: string;
  transport: Transport;
  url?: string;
  authToken?: string;
  headers?: string;
  command?: string;
  args?: string;
};

/** The ENABLED servers a position holds, with raw auth, for buildRunSpec. */
export async function mcpsForPositionWithSecrets(
  positionId: string
): Promise<McpServerConfig[]> {
  const links = await prisma.positionMcp.findMany({
    where: { positionId },
    include: { mcpServer: true },
  });
  return links
    .map((l) => l.mcpServer)
    .filter((s) => s.enabled)
    .map((s) => ({
      name: s.name,
      transport: (s.transport as Transport) ?? 'http',
      ...(s.url ? { url: s.url } : {}),
      ...(s.authToken ? { authToken: s.authToken } : {}),
      ...(s.headers ? { headers: s.headers } : {}),
      ...(s.command ? { command: s.command } : {}),
      ...(s.args ? { args: s.args } : {}),
    }));
}
