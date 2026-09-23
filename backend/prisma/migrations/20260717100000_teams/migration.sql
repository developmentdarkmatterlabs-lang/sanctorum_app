-- Org model: Teams and Positions. A Team optionally homes on a Floor (Room),
-- has a mission and a set of Positions. A Position is a seat that carries
-- clearance (moving it off the character) and will own role-scoped memory. An
-- Agent optionally holds one Position (Agent.positionId, unique).
--
-- All additive/nullable, so existing floors, agents and seats are untouched:
-- every agent starts unassigned (positionId NULL) until placed on a team.

PRAGMA foreign_keys=OFF;

-- Team --------------------------------------------------------------------
CREATE TABLE "Team" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "name"      TEXT NOT NULL,
    "mission"   TEXT NOT NULL DEFAULT '',
    "floorId"   TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Team_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Team_floorId_key" ON "Team"("floorId");
CREATE INDEX "Team_floorId_idx" ON "Team"("floorId");

-- Position ----------------------------------------------------------------
CREATE TABLE "Position" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "teamId"    TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "clearance" INTEGER NOT NULL DEFAULT 1,
    "isLeader"  BOOLEAN NOT NULL DEFAULT false,
    "order"     INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Position_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Position_teamId_idx" ON "Position"("teamId");

-- Agent: add positionId (unique, nullable) via table rebuild --------------
CREATE TABLE "new_Agent" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "key"          TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "room"         INTEGER NOT NULL,
    "seat"         INTEGER NOT NULL,
    "seatId"       TEXT,
    "positionId"   TEXT,
    "spritePath"   TEXT NOT NULL,
    "portraitPath" TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "tagline"      TEXT NOT NULL,
    "role"         TEXT NOT NULL DEFAULT 'Employee',
    "clearance"    INTEGER NOT NULL DEFAULT 1,
    "dataType"     INTEGER NOT NULL DEFAULT 2,
    "tenure"       TEXT NOT NULL DEFAULT 'New hire',
    "focus"        TEXT NOT NULL DEFAULT '',
    "rowOrder"     TEXT NOT NULL DEFAULT '["down","right","up","left"]',
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL,
    CONSTRAINT "Agent_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Agent_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Agent" (
    "id", "key", "name", "room", "seat", "seatId", "spritePath", "portraitPath",
    "title", "tagline", "role", "clearance", "dataType", "tenure", "focus",
    "rowOrder", "createdAt", "updatedAt"
)
SELECT
    "id", "key", "name", "room", "seat", "seatId", "spritePath", "portraitPath",
    "title", "tagline", "role", "clearance", "dataType", "tenure", "focus",
    "rowOrder", "createdAt", "updatedAt"
FROM "Agent";

DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";

CREATE UNIQUE INDEX "Agent_key_key" ON "Agent"("key");
CREATE UNIQUE INDEX "Agent_seatId_key" ON "Agent"("seatId");
CREATE UNIQUE INDEX "Agent_positionId_key" ON "Agent"("positionId");
CREATE UNIQUE INDEX "Agent_room_seat_key" ON "Agent"("room", "seat");

PRAGMA foreign_keys=ON;
