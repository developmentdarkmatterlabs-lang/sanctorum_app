-- Give seats stable identity. The Seat table is populated from the frontend's
-- ROOMS grids (as of this migration), and every existing agent is backfilled
-- to point at the seat matching its current (room, seat) — so nobody moves.

-- Seat: one row per desk position that exists today.
CREATE TABLE "Seat" (
    "id"   TEXT NOT NULL PRIMARY KEY,
    "room" INTEGER NOT NULL,
    "seat" INTEGER NOT NULL,
    "tx"   INTEGER NOT NULL,
    "ty"   INTEGER NOT NULL
);
CREATE UNIQUE INDEX "Seat_room_seat_key" ON "Seat"("room", "seat");

INSERT INTO "Seat" ("id", "room", "seat", "tx", "ty") VALUES
  ('seat_0_0', 0, 0, 6, 2),
  ('seat_0_1', 0, 1, 17, 14),
  ('seat_0_2', 0, 2, 4, 17),
  ('seat_0_3', 0, 3, 15, 5),
  ('seat_0_4', 0, 4, 2, 9),
  ('seat_0_5', 0, 5, 10, 12),
  ('seat_1_0', 1, 0, 5, 2),
  ('seat_1_1', 1, 1, 14, 16),
  ('seat_1_2', 1, 2, 2, 13),
  ('seat_1_3', 1, 3, 17, 6),
  ('seat_1_4', 1, 4, 10, 7),
  ('seat_1_5', 1, 5, 8, 13),
  ('seat_2_0', 2, 0, 5, 2),
  ('seat_2_1', 2, 1, 14, 16),
  ('seat_2_2', 2, 2, 2, 13),
  ('seat_2_3', 2, 3, 17, 6),
  ('seat_2_4', 2, 4, 10, 7),
  ('seat_2_5', 2, 5, 8, 13),
  ('seat_3_0', 3, 0, 6, 2),
  ('seat_3_1', 3, 1, 13, 16),
  ('seat_3_2', 3, 2, 2, 13),
  ('seat_3_3', 3, 3, 17, 6),
  ('seat_3_4', 3, 4, 10, 8),
  ('seat_3_5', 3, 5, 2, 7),
  ('seat_4_0', 4, 0, 8, 2),
  ('seat_4_1', 4, 1, 14, 16),
  ('seat_4_2', 4, 2, 2, 13),
  ('seat_4_3', 4, 3, 17, 7),
  ('seat_4_4', 4, 4, 10, 9),
  ('seat_4_5', 4, 5, 2, 6),
  ('seat_5_0', 5, 0, 5, 3),
  ('seat_5_1', 5, 1, 16, 15),
  ('seat_5_2', 5, 2, 4, 6),
  ('seat_5_3', 5, 3, 12, 6),
  ('seat_5_4', 5, 4, 6, 11),
  ('seat_5_5', 5, 5, 12, 12),
  ('seat_6_0', 6, 0, 8, 2),
  ('seat_6_1', 6, 1, 17, 15),
  ('seat_6_2', 6, 2, 2, 15),
  ('seat_6_3', 6, 3, 17, 5),
  ('seat_6_4', 6, 4, 9, 12),
  ('seat_6_5', 6, 5, 2, 5),
  ('seat_7_0', 7, 0, 5, 2),
  ('seat_7_1', 7, 1, 17, 14),
  ('seat_7_2', 7, 2, 2, 14),
  ('seat_7_3', 7, 3, 14, 5),
  ('seat_7_4', 7, 4, 9, 12),
  ('seat_7_5', 7, 5, 3, 8),
  ('seat_8_0', 8, 0, 6, 2),
  ('seat_8_1', 8, 1, 17, 16),
  ('seat_8_2', 8, 2, 2, 16),
  ('seat_8_3', 8, 3, 17, 5),
  ('seat_8_4', 8, 4, 7, 10),
  ('seat_8_5', 8, 5, 13, 10),
  ('seat_9_0', 9, 0, 5, 2),
  ('seat_9_1', 9, 1, 14, 16),
  ('seat_9_2', 9, 2, 17, 5),
  ('seat_9_3', 9, 3, 2, 13),
  ('seat_9_4', 9, 4, 10, 8),
  ('seat_9_5', 9, 5, 11, 2),
  ('seat_10_0', 10, 0, 3, 2),
  ('seat_10_1', 10, 1, 17, 16),
  ('seat_10_2', 10, 2, 2, 16),
  ('seat_10_3', 10, 3, 16, 2),
  ('seat_10_4', 10, 4, 7, 9),
  ('seat_10_5', 10, 5, 13, 11);

-- Add the nullable seatId column to Agent.
ALTER TABLE "Agent" ADD COLUMN "seatId" TEXT;

-- Backfill: each agent adopts the seat matching its current (room, seat).
UPDATE "Agent"
SET "seatId" = (
  SELECT "Seat"."id" FROM "Seat"
  WHERE "Seat"."room" = "Agent"."room" AND "Seat"."seat" = "Agent"."seat"
);

CREATE UNIQUE INDEX "Agent_seatId_key" ON "Agent"("seatId");
