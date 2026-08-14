import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  json,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users.js";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),

  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),

  items: json("items")
    .notNull()
    .$type<
      Array<{
        productId: number;
        productName: string;
        price: number;
        currency: string;
        quantity: number;
        imageUrl: string | null;
      }>
    >(),

  total: numeric("total", {
    precision: 18,
    scale: 6,
  }).notNull(),

  currency: text("currency")
    .notNull()
    .default("Pi"),

  status: text("status")
    .notNull()
    .default("pending"),

  paymentMethod: text("payment_method")
    .notNull()
    .default("pi"),

  piPaymentId: text("pi_payment_id"),

  piTxid: text("pi_txid"),

  shippingAddress: text("shipping_address"),

  notes: text("notes"),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertOrderSchema =
  createInsertSchema(ordersTable).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });

export type InsertOrder =
  z.infer<typeof insertOrderSchema>;

export type Order =
  typeof ordersTable.$inferSelect;