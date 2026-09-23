-- Optional human label for a desk. Additive, defaulted -> plain ADD COLUMN.
ALTER TABLE "Seat" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
