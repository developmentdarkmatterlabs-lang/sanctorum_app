import { Router } from 'express';
import {
  assignMcp,
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  mcpsForPosition,
  unassignMcp,
  updateMcpServer,
  type McpServerInput,
  type Transport,
} from '../../database/moduledb/moduleservices/mcpService';

// The MCP server library + assignment surface. Servers are external; assigned to
// POSITIONS (seats); merged into the run's tools in the Python service.
//   GET    /api/mcp                             list the library (auth masked)
//   POST   /api/mcp                             register a server
//   PATCH  /api/mcp/:id                         edit
//   DELETE /api/mcp/:id                         delete (assignments cascade)
//   GET    /api/mcp/position/:positionId        servers held by a position
//   POST   /api/mcp/position/:positionId        assign { mcpServerId }
//   DELETE /api/mcp/position/:positionId/:mcpServerId  unassign

const router = Router();

/** Pull an McpServerInput out of a request body (raw authToken accepted here). */
function readInput(body: Record<string, unknown>): McpServerInput {
  const input: McpServerInput = {};
  if (typeof body.name === 'string') input.name = body.name;
  if (typeof body.description === 'string') input.description = body.description;
  if (body.transport === 'http' || body.transport === 'stdio')
    input.transport = body.transport as Transport;
  if (typeof body.url === 'string') input.url = body.url;
  if (typeof body.authToken === 'string') input.authToken = body.authToken;
  if (typeof body.headers === 'string') input.headers = body.headers;
  if (typeof body.command === 'string') input.command = body.command;
  if (typeof body.args === 'string') input.args = body.args;
  if (body.minClearance !== undefined) input.minClearance = Number(body.minClearance);
  if (typeof body.enabled === 'boolean') input.enabled = body.enabled;
  return input;
}

router.get('/', async (_req, res) => {
  try {
    res.json(await listMcpServers());
  } catch (error) {
    console.error('GET /api/mcp failed:', error);
    res.status(500).json({ error: 'Failed to list MCP servers' });
  }
});

router.post('/', async (req, res) => {
  const input = readInput(req.body ?? {});
  if (!input.name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await createMcpServer(input);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json(result.server);
  } catch (error) {
    console.error('POST /api/mcp failed:', error);
    res.status(500).json({ error: 'Failed to create MCP server' });
  }
});

router.patch('/:id', async (req, res) => {
  const input = readInput(req.body ?? {});
  if (Object.keys(input).length === 0) {
    return res.status(400).json({ error: 'no editable fields supplied' });
  }
  try {
    const result = await updateMcpServer(req.params.id, input);
    if (result.ok) return res.json(result.server);
    if ('notFound' in result) return res.status(404).json({ error: 'MCP server not found' });
    return res.status(400).json({ error: result.error });
  } catch (error) {
    console.error('PATCH /api/mcp/:id failed:', error);
    res.status(500).json({ error: 'Failed to update MCP server' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteMcpServer(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'MCP server not found' });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /api/mcp/:id failed:', error);
    res.status(500).json({ error: 'Failed to delete MCP server' });
  }
});

router.get('/position/:positionId', async (req, res) => {
  try {
    res.json(await mcpsForPosition(req.params.positionId));
  } catch (error) {
    console.error('GET /api/mcp/position/:positionId failed:', error);
    res.status(500).json({ error: 'Failed to list position MCP servers' });
  }
});

router.post('/position/:positionId', async (req, res) => {
  const mcpServerId = String(req.body?.mcpServerId ?? '').trim();
  if (!mcpServerId) return res.status(400).json({ error: 'mcpServerId is required' });
  try {
    const result = await assignMcp(req.params.positionId, mcpServerId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/mcp/position/:positionId failed:', error);
    res.status(500).json({ error: 'Failed to assign MCP server' });
  }
});

router.delete('/position/:positionId/:mcpServerId', async (req, res) => {
  try {
    await unassignMcp(req.params.positionId, req.params.mcpServerId);
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/mcp/position/:positionId/:mcpServerId failed:', error);
    res.status(500).json({ error: 'Failed to unassign MCP server' });
  }
});

export default router;
