// Load environment variables first
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BACKEND_ROOT, PROJECT_ROOT, DATA_ROOT } from './paths';

// Load default .env first
dotenv.config();
// Load user keys from .env.user (overrides defaults if present)
dotenv.config({ path: path.join(BACKEND_ROOT, '.env.user'), override: true });

import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/healthRoutes';
// Import module routes here following this pattern:
// import moduleRoutes from './routes/moduleRoutes/moduleRoutes';
import agentRoutes from './routes/moduleRoutes/agentRoutes';
import roomRoutes from './routes/moduleRoutes/roomRoutes';
import teamRoutes from './routes/moduleRoutes/teamRoutes';
import memoryRoutes from './routes/moduleRoutes/memoryRoutes';
import skillRoutes from './routes/moduleRoutes/skillRoutes';
import mcpRoutes from './routes/moduleRoutes/mcpRoutes';
import ruleRoutes from './routes/moduleRoutes/ruleRoutes';
import personalityRoutes from './routes/moduleRoutes/personalityRoutes';
import roleRoutes from './routes/moduleRoutes/roleRoutes';
import inboxRoutes from './routes/moduleRoutes/inboxRoutes';
import runtimeRoutes from './routes/moduleRoutes/runtimeRoutes';
import settingsRoutes from './routes/moduleRoutes/settingsRoutes';
import { setRuntime } from './database/moduledb/moduleservices/inboxService';
import { HttpRuntime } from './runtime/HttpRuntime';

const app = express();
const PORT = process.env.PORT || 3001;

// Wire the real (out-of-process) AI runtime only when it's configured. Without
// AISERVICE_URL the StubRuntime stays the default, so dev runs with no Python and
// no paid LLM calls. This is the deliberate, env-gated flip from stub to real.
if (process.env.AISERVICE_URL) {
  setRuntime(new HttpRuntime(process.env.AISERVICE_URL));
  console.log(`AI runtime: HTTP -> ${process.env.AISERVICE_URL}`);
} else {
  console.log('AI runtime: stub (set AISERVICE_URL to use the Python service)');
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(PROJECT_ROOT, 'frontend/public/uploads')));
app.use('/api/uploads', express.static(path.join(DATA_ROOT, 'uploads')));

// Routes — add new modules following this pattern:
// app.use('/api/moduleName', moduleRoutes);
app.use(healthRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/personalities', personalityRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/runtime', runtimeRoutes);
app.use('/api/settings', settingsRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
