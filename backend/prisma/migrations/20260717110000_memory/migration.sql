-- Memory: accumulated knowledge scoped to a team, a position (the seat's
-- role-memory), or an agent. Additive table, nothing else touched. Reads are
-- gated in the service layer by the requesting agent's membership and effective
-- clearance — the `clearance` column is the per-entry minimum for position memory.

CREATE TABLE "Memory" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "scope"          TEXT NOT NULL,
    "ownerId"        TEXT NOT NULL,
    "kind"           TEXT NOT NULL DEFAULT 'note',
    "body"           TEXT NOT NULL,
    "clearance"      INTEGER NOT NULL DEFAULT 0,
    "authorAgentKey" TEXT,
    "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Memory_scope_ownerId_idx" ON "Memory"("scope", "ownerId");
