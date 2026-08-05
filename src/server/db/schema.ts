import { pgTable, text, integer, uuid, timestamp } from 'drizzle-orm/pg-core';

// ponytail: only the persisted facts locks+availability need. Seat rows, guests,
// slips, admin all stay in client BookingContext for now (see plan "out of scope").
export const tables = pgTable('tables', {
  id: text('id').primaryKey(), // "T01".."T70"
  zone: text('zone').notNull(), // 'alumni' | 'student'
  pricePerTable: integer('price_per_table').notNull(),
  capacity: integer('capacity').notNull(),
  status: text('status').notNull(), // 'available' | 'booked' | 'closed'
});

// Persisted purchase record. UUID PK (server-owned); `ref` is the client-minted
// "BK-2026-xxxx" code, unique so a re-confirm of the same slip can't double-insert.
// tableId is nullable — an individual ticket carries no table (FK still holds when set).
export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ref: text('ref').notNull().unique(),
  tableId: text('table_id').references(() => tables.id),
  buyerName: text('buyer_name').notNull(),
  phone: text('phone').notNull(),
  email: text('email').notNull(),
  lineId: text('line_id'),
  bookingType: text('booking_type').notNull(), // 'whole_table' | 'individual_seats' | 'individual'
  finalAmount: integer('final_amount').notNull(),
  status: text('status').notNull().default('confirmed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type TableRow = typeof tables.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
