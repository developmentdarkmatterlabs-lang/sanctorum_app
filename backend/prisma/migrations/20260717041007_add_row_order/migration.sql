-- RedefineTables
PRAGMA defer_foreign_keys=ON;
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
    "traits" TEXT NOT NULL DEFAULT '[]',
    "rowOrder" TEXT NOT NULL DEFAULT '["down","right","up","left"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Agent" ("createdAt", "id", "key", "name", "portraitPath", "room", "seat", "spritePath", "tagline", "title", "traits", "updatedAt") SELECT "createdAt", "id", "key", "name", "portraitPath", "room", "seat", "spritePath", "tagline", "title", "traits", "updatedAt" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_key_key" ON "Agent"("key");
CREATE UNIQUE INDEX "Agent_room_seat_key" ON "Agent"("room", "seat");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
