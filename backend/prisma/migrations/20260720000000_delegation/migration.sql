-- Phase 4: team delegation — the run tree + editable limits.
--
-- `Run` is one row per agent run, linked into a delegation TREE by parentRunId /
-- rootRunId. Every run writes one (a solo run is a tree of one), so nothing in
-- Phases 1-3.9 is special-cased.
--
-- All of this is additive: new table + nullable/defaulted columns, so SQLite needs
-- no table rebuild and no existing row changes meaning.

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "agentKey" TEXT,
    "parentRunId" TEXT,
    "rootRunId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "result" TEXT NOT NULL DEFAULT '',
    "cost" REAL NOT NULL DEFAULT 0,
    "maxDepth" INTEGER NOT NULL DEFAULT 3,
    "maxRuns" INTEGER NOT NULL DEFAULT 12,
    "maxCost" REAL NOT NULL DEFAULT 2.0,
    "positionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Run_rootRunId_idx" ON "Run"("rootRunId");
CREATE INDEX "Run_parentRunId_idx" ON "Run"("parentRunId");
CREATE INDEX "Run_threadId_idx" ON "Run"("threadId");

-- AlterTable: the thread's pointer at the delegation tree running on it. The
-- existing singular activeRunId/pendingRunId stay for solo runs (unchanged).
ALTER TABLE "Thread" ADD COLUMN "rootRunId" TEXT;

-- AlterTable: the delegation limits, editable in the settings panel.
-- depth is clamped 1-10 in the service (no "unlimited" — it is the cycle guard);
-- runs and cost take 0 = unlimited.
ALTER TABLE "AppSettings" ADD COLUMN "maxDelegationDepth" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "AppSettings" ADD COLUMN "maxRunsPerTree" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "AppSettings" ADD COLUMN "maxCostPerTree" REAL NOT NULL DEFAULT 2.0;
