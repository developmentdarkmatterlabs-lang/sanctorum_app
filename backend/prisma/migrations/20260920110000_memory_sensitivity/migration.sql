-- Memory sensitivity — the gate that finally makes `dataType` mean something.
--
-- Until now dataType was stored, displayed and never read: Level 14 "Palantir
-- Access" was a number on a form. Clearance says what an agent may DO; this says
-- what it may KNOW.
--
-- Defaults to 1 (Public) so every existing row stays readable by everyone.
ALTER TABLE "Memory" ADD COLUMN "dataType" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "Memory_dataType_idx" ON "Memory"("dataType");
