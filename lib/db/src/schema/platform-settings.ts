import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent platform-wide settings. Values are stored as decimals so
 * commission changes survive deployments and server restarts.
 */
export const platformSettingsTable = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: numeric("value", { precision: 10, scale: 4 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
