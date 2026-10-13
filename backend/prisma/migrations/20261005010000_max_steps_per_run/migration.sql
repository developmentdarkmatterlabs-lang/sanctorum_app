-- Tool rounds one run may take unattended before it is stopped. 0 = unlimited.
-- LangGraph's own default (10007 steps) is effectively no limit at all.
ALTER TABLE "AppSettings" ADD COLUMN "maxStepsPerRun" INTEGER NOT NULL DEFAULT 200;
