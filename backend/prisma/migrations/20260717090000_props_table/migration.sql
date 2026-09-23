-- Props move from a JSON column on Room into their own table, gaining a
-- `blocking` flag. Existing decorative props are migrated as NON-blocking so
-- the seeded floors stay exactly as walkable as before; only editor-placed
-- props block.

PRAGMA foreign_keys=OFF;

CREATE TABLE "Prop" (
    "id"       TEXT NOT NULL PRIMARY KEY,
    "roomId"   TEXT NOT NULL,
    "kind"     TEXT NOT NULL,
    "x"        INTEGER NOT NULL,
    "y"        INTEGER NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Prop_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Copy each room's JSON props into rows. Deterministic ids (roomId + coords)
-- keep this reproducible; blocking is 0 to preserve current walkability.
INSERT INTO "Prop" ("id", "roomId", "kind", "x", "y", "rotation", "blocking")
SELECT
    "Room"."id" || '_prop_' || json_extract(p.value, '$.x') || '_' || json_extract(p.value, '$.y'),
    "Room"."id",
    json_extract(p.value, '$.kind'),
    json_extract(p.value, '$.x'),
    json_extract(p.value, '$.y'),
    0,
    0
FROM "Room", json_each("Room"."props") AS p;

CREATE UNIQUE INDEX "Prop_roomId_x_y_key" ON "Prop"("roomId", "x", "y");
CREATE INDEX "Prop_roomId_idx" ON "Prop"("roomId");

-- Drop the props column by rebuilding Room without it.
CREATE TABLE "new_Room" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "order"     INTEGER NOT NULL,
    "name"      TEXT NOT NULL,
    "bg"        TEXT NOT NULL,
    "grid"      TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Room" ("id", "order", "name", "bg", "grid", "createdAt", "updatedAt")
SELECT "id", "order", "name", "bg", "grid", "createdAt", "updatedAt" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_order_key" ON "Room"("order");

PRAGMA foreign_keys=ON;
