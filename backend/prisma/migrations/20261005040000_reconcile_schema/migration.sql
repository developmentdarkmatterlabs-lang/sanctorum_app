-- Brings three tables in line with schema.prisma; every row is copied, nothing is dropped.
--   Agent: personalityId FK gains ON UPDATE CASCADE, and its index is declared.
--   Personality: "enabled" becomes BOOLEAN (stored values are unchanged).
--   Team: parentTeamId gains the FK it never had, so deleting a team clears its children's link.

-- Old team deletes could leave links to teams that no longer exist; clear them first.
UPDATE "Team" SET "parentTeamId" = NULL
  WHERE "parentTeamId" IS NOT NULL AND "parentTeamId" NOT IN (SELECT "id" FROM "Team");
UPDATE "Agent" SET "personalityId" = NULL
  WHERE "personalityId" IS NOT NULL AND "personalityId" NOT IN (SELECT "id" FROM "Personality");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "room" INTEGER NOT NULL,
    "seat" INTEGER NOT NULL,
    "seatId" TEXT,
    "positionId" TEXT,
    "spritePath" TEXT NOT NULL,
    "portraitPath" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "model" TEXT,
    "imageModel" TEXT,
    "speechModel" TEXT,
    "webMode" TEXT,
    "personalityId" TEXT,
    "maxCost" REAL,
    "maxSteps" INTEGER,
    "workspaceDir" TEXT,
    "workspaceReadOnly" BOOLEAN NOT NULL DEFAULT true,
    "supervised" BOOLEAN NOT NULL DEFAULT true,
    "trustedDelegator" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'Employee',
    "clearance" INTEGER NOT NULL DEFAULT 1,
    "dataType" INTEGER NOT NULL DEFAULT 2,
    "tenure" TEXT NOT NULL DEFAULT 'New hire',
    "focus" TEXT NOT NULL DEFAULT '',
    "rowOrder" TEXT NOT NULL DEFAULT '["down","right","up","left"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Agent_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_personalityId_fkey" FOREIGN KEY ("personalityId") REFERENCES "Personality" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Agent" ("clearance", "createdAt", "dataType", "focus", "id", "imageModel", "key", "maxCost", "maxSteps", "model", "name", "personalityId", "portraitPath", "positionId", "role", "room", "rowOrder", "seat", "seatId", "speechModel", "spritePath", "supervised", "tagline", "tenure", "title", "trustedDelegator", "updatedAt", "webMode", "workspaceDir", "workspaceReadOnly") SELECT "clearance", "createdAt", "dataType", "focus", "id", "imageModel", "key", "maxCost", "maxSteps", "model", "name", "personalityId", "portraitPath", "positionId", "role", "room", "rowOrder", "seat", "seatId", "speechModel", "spritePath", "supervised", "tagline", "tenure", "title", "trustedDelegator", "updatedAt", "webMode", "workspaceDir", "workspaceReadOnly" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_key_key" ON "Agent"("key");
CREATE UNIQUE INDEX "Agent_seatId_key" ON "Agent"("seatId");
CREATE UNIQUE INDEX "Agent_positionId_key" ON "Agent"("positionId");
CREATE INDEX "Agent_personalityId_idx" ON "Agent"("personalityId");
CREATE UNIQUE INDEX "Agent_room_seat_key" ON "Agent"("room", "seat");
CREATE TABLE "new_Personality" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "stance" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Personality" ("body", "createdAt", "enabled", "id", "name", "stance", "summary", "updatedAt") SELECT "body", "createdAt", "enabled", "id", "name", "stance", "summary", "updatedAt" FROM "Personality";
DROP TABLE "Personality";
ALTER TABLE "new_Personality" RENAME TO "Personality";
CREATE TABLE "new_Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mission" TEXT NOT NULL DEFAULT '',
    "floorId" TEXT,
    "parentTeamId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Team_parentTeamId_fkey" FOREIGN KEY ("parentTeamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("createdAt", "floorId", "id", "mission", "name", "parentTeamId", "updatedAt") SELECT "createdAt", "floorId", "id", "mission", "name", "parentTeamId", "updatedAt" FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE UNIQUE INDEX "Team_floorId_key" ON "Team"("floorId");
CREATE INDEX "Team_floorId_idx" ON "Team"("floorId");
CREATE INDEX "Team_parentTeamId_idx" ON "Team"("parentTeamId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
