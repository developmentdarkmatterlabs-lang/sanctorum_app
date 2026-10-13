-- Answer a repeat read of an unchanged file with a short note instead of the
-- file again. On by default; a second ask in a row still returns the full text.
ALTER TABLE "AppSettings" ADD COLUMN "dedupeReads" BOOLEAN NOT NULL DEFAULT true;
