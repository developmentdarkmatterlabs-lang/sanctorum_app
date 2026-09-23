-- Supervised pause state on a thread: the run awaiting a decision and the step
-- it proposes. Additive, nullable -> plain ADD COLUMN.
ALTER TABLE "Thread" ADD COLUMN "pendingRunId" TEXT;
ALTER TABLE "Thread" ADD COLUMN "pendingStep" TEXT;
