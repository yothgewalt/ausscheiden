import { notInArray, sql } from 'drizzle-orm';
import { db } from './index';
import { tables, settings } from './schema';
import { generateInitialTables, INDIVIDUAL_CAPACITY } from '../../data/mockData';

// Reuse the single source of truth for the 70-table layout (students {61-70},
// rest alumni) so seed and client never drift.
async function seed() {
  const rows = generateInitialTables().map((t) => ({
    id: t.id,
    zone: t.zone,
    pricePerTable: t.pricePerTable,
    capacity: t.capacity,
    // Preserve 'closed' (reserve tables 59/60) as well as 'booked'; everything else → available.
    status: t.status === 'booked' || t.status === 'closed' ? t.status : 'available',
  }));

  for (const row of rows) {
    await db
      .insert(tables)
      .values(row)
      .onConflictDoUpdate({
        target: tables.id,
        // ponytail: re-seed refreshes zone/price/capacity, applies the intended seed status
        // (e.g. 'closed' for reserve 59/60) but never clobbers a live 'booked' → a real
        // booking survives re-seeding. CASE runs in SQL so upserts get the new status too.
        set: {
          zone: row.zone,
          pricePerTable: row.pricePerTable,
          capacity: row.capacity,
          status: sql`CASE WHEN ${tables.status} = 'booked' THEN 'booked' ELSE ${row.status} END`,
        },
      });
  }

  // Prune rows from a prior 72-table seed (T71/T72) — only 70 tables now.
  await db.delete(tables).where(notInArray(tables.id, rows.map((r) => r.id)));

  // Config singleton (id=1). onConflictDoNothing so a hand-edited capacity in the
  // DB survives a re-seed — only the first seed writes the default.
  await db
    .insert(settings)
    .values({ id: 1, individualCapacity: INDIVIDUAL_CAPACITY })
    .onConflictDoNothing({ target: settings.id });

  console.log(`Seeded ${rows.length} tables + settings.`);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
