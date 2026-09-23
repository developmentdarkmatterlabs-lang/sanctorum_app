-- Decorative floor tiles: cosmetic overlay, one per (room, x, y).
CREATE TABLE "Tile" (
    "id"       TEXT NOT NULL PRIMARY KEY,
    "roomId"   TEXT NOT NULL,
    "kind"     TEXT NOT NULL,
    "x"        INTEGER NOT NULL,
    "y"        INTEGER NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Tile_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Tile_roomId_x_y_key" ON "Tile"("roomId", "x", "y");
CREATE INDEX "Tile_roomId_idx" ON "Tile"("roomId");
