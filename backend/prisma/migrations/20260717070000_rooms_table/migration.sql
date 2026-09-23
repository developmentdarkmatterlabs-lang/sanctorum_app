-- Floors move from a frontend constant into the database. The seed populates
-- the 11 rows; this migration just creates the table.
CREATE TABLE "Room" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "order"     INTEGER NOT NULL,
    "name"      TEXT NOT NULL,
    "bg"        TEXT NOT NULL,
    "grid"      TEXT NOT NULL,
    "props"     TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "Room_order_key" ON "Room"("order");
