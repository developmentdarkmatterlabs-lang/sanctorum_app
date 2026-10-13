-- Per-call token usage, so a run's spend can be read step by step.
ALTER TABLE "Run" ADD COLUMN "promptTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Run" ADD COLUMN "completionTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Run" ADD COLUMN "cachedTokens" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "RunUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "RunUsage_runId_idx" ON "RunUsage"("runId");
