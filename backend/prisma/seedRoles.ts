/**
 * Seeds the Role library from the shared taxonomy.
 *
 * WHY THIS EXISTS. Two lists of "roles" used to disagree:
 *
 *   - the dossier's ROLE dropdown, fed by ROLE_GROUPS in utils/taxonomy.ts — 217
 *     hardcoded strings, a descriptive LABEL on the person;
 *   - the Roles tab, backed by the `Role` table — the job a seat references, and
 *     the thing that actually resolves to clearance.
 *
 * Seeding the taxonomy into the table makes them one list, so what you see in
 * the Roles tab is what you can assign anywhere.
 *
 * IDEMPOTENT and NON-DESTRUCTIVE. It only inserts titles that do not already
 * exist. A role you created and tuned (say "Story Lead" at clearance 6) is never
 * touched, and neither is one whose title happens to match — your clearance wins,
 * because a seeded default must never silently move seats that already hold it.
 *
 * Run: npm run db:seed:roles
 */

import { prisma } from '../database/db';
import { ROLE_GROUPS } from '../utils/taxonomy';

/**
 * Default clearance for a seeded role, by discipline.
 *
 * A guess, deliberately CONSERVATIVE: most land at 1-3 (read, and write at 3),
 * and nothing is seeded at 6+ where `delegate` and secrets live. Raising a role
 * is a deliberate act in the Roles tab; a seed that handed out shell access
 * would be the wrong default in exactly the way this whole app exists to avoid.
 */
const CLEARANCE_BY_GROUP: Record<string, number> = {
  Leadership: 5,
  'Individual Contributor Track': 3,
  'Systems & IT': 5,
  'DevOps & Cloud': 5,
  Cybersecurity: 5,
  Networking: 4,
  Database: 4,
  'Software — Backend': 3,
  'Software — Frontend': 3,
  'Software — Full Stack & Desktop': 3,
  'Embedded & Robotics': 3,
  'Artificial Intelligence': 3,
  'Data & Analytics': 3,
  'Quality Assurance': 3,
  'Game Development': 3,
  'Blockchain & Web3': 3,
  'Enterprise Applications': 3,
  'Product & Design': 2,
  Research: 2,
  'Technical Documentation': 2,
  'Business & Operations': 1,
};

const DEFAULT_CLEARANCE = 2;

async function main(): Promise<void> {
  const taxonomy = ROLE_GROUPS.flatMap((g) =>
    g.roles.map((title) => ({
      title,
      discipline: g.group,
      defaultClearance: CLEARANCE_BY_GROUP[g.group] ?? DEFAULT_CLEARANCE,
    }))
  );

  const existing = new Set((await prisma.role.findMany({ select: { title: true } })).map((r) => r.title));
  const toInsert = taxonomy.filter((t) => !existing.has(t.title));

  if (toInsert.length === 0) {
    console.log(`Role library already covers all ${taxonomy.length} taxonomy roles — nothing to do.`);
    return;
  }

  await prisma.role.createMany({
    data: toInsert.map((t) => ({
      title: t.title,
      discipline: t.discipline,
      defaultClearance: t.defaultClearance,
      description: `Seeded from the ${t.discipline} taxonomy group.`,
    })),
  });

  console.log(`Seeded ${toInsert.length} roles (${existing.size} already existed, left untouched).`);
  const byGroup = new Map<string, number>();
  for (const t of toInsert) byGroup.set(t.discipline, (byGroup.get(t.discipline) ?? 0) + 1);
  for (const [group, n] of [...byGroup].sort()) {
    console.log(`  ${group}: ${n} (clearance ${CLEARANCE_BY_GROUP[group] ?? DEFAULT_CLEARANCE})`);
  }
}

main()
  .catch((e) => {
    console.error('Role seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
