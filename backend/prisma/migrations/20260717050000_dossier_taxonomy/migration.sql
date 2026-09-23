-- Replace the free-form `traits` JSON blob with constrained columns.
-- Tenure and focus are carried across from the old JSON so existing agents
-- keep their flavour text; clearance/role are re-derived by the seed, since
-- the old values ("Omega", "Systems") do not map onto the new ladders.

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "room" INTEGER NOT NULL,
    "seat" INTEGER NOT NULL,
    "spritePath" TEXT NOT NULL,
    "portraitPath" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Employee',
    "clearance" INTEGER NOT NULL DEFAULT 1,
    "dataType" INTEGER NOT NULL DEFAULT 2,
    "tenure" TEXT NOT NULL DEFAULT 'New hire',
    "focus" TEXT NOT NULL DEFAULT '',
    "rowOrder" TEXT NOT NULL DEFAULT '["down","right","up","left"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- json_extract pulls the old label/value pairs across where they exist.
INSERT INTO "new_Agent" (
    "id", "key", "name", "room", "seat", "spritePath", "portraitPath",
    "title", "tagline", "tenure", "focus", "rowOrder", "createdAt", "updatedAt"
)
SELECT
    "id", "key", "name", "room", "seat", "spritePath", "portraitPath",
    "title", "tagline",
    COALESCE(
      (SELECT json_extract(value, '$.value') FROM json_each("traits")
       WHERE json_extract(value, '$.label') = 'Tenure'),
      'New hire'
    ),
    COALESCE(
      (SELECT json_extract(value, '$.value') FROM json_each("traits")
       WHERE json_extract(value, '$.label') = 'Focus'),
      ''
    ),
    "rowOrder", "createdAt", "updatedAt"
FROM "Agent";

DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";

CREATE UNIQUE INDEX "Agent_key_key" ON "Agent"("key");
CREATE UNIQUE INDEX "Agent_room_seat_key" ON "Agent"("room", "seat");

PRAGMA foreign_keys=ON;
