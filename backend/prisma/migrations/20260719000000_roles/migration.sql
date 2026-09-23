-- Phase 3.9: the Role catalog (job architecture) + live inheritance on Position.
-- A Role is defined once; many seats reference it and INHERIT its title/clearance.
-- Position.title/clearance become NULLABLE overrides (null = inherit).

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "discipline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "defaultClearance" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_title_key" ON "Role"("title");
CREATE INDEX "Role_discipline_idx" ON "Role"("discipline");

-- Backfill: one Role per DISTINCT (title, clearance) already in use. The role id is
-- derived from the title so the link-up below is a simple join. rowid keeps it
-- deterministic without needing a uuid function.
INSERT INTO "Role" ("id", "title", "level", "discipline", "description", "defaultClearance", "createdAt", "updatedAt")
SELECT
    'role_' || CAST(ROW_NUMBER() OVER (ORDER BY "title") AS TEXT),
    "title",
    0,
    '',
    '',
    "clearance",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "title", "clearance" FROM "Position");

-- RedefineTables: SQLite can't ALTER a column to NULL, so rebuild Position.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "roleId" TEXT,
    "titleOverride" TEXT,
    "clearanceOverride" INTEGER,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Position_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Position_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Copy every seat, linking it to the role matching its (title, clearance) and
-- leaving BOTH overrides NULL — they equal the role, so the seat inherits.
INSERT INTO "new_Position" ("id", "teamId", "roleId", "titleOverride", "clearanceOverride", "isLeader", "order")
SELECT
    p."id",
    p."teamId",
    (SELECT r."id" FROM "Role" r WHERE r."title" = p."title" AND r."defaultClearance" = p."clearance"),
    NULL,
    NULL,
    p."isLeader",
    p."order"
FROM "Position" p;

DROP TABLE "Position";
ALTER TABLE "new_Position" RENAME TO "Position";

CREATE INDEX "Position_teamId_idx" ON "Position"("teamId");
CREATE INDEX "Position_roleId_idx" ON "Position"("roleId");

PRAGMA foreign_keys=ON;
