-- Inbox: Threads and Messages. A Thread targets an agent (DM) or a team
-- (broadcast). Messages carry a sender (user/agent/system) and a nullable readAt
-- driving the unread badge. Additive tables, nothing else touched.

CREATE TABLE "Thread" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "agentKey"  TEXT,
    "teamId"    TEXT,
    "subject"   TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "Thread_agentKey_idx" ON "Thread"("agentKey");
CREATE INDEX "Thread_teamId_idx" ON "Thread"("teamId");

CREATE TABLE "Message" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "threadId"  TEXT NOT NULL,
    "sender"    TEXT NOT NULL,
    "agentKey"  TEXT,
    "body"      TEXT NOT NULL,
    "resultRef" TEXT,
    "readAt"    DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Message_threadId_idx" ON "Message"("threadId");
