import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users.js";
import { ordersTable } from "./orders.js";

export const paymentsTable = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),

    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id),

    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),

    method: text("method")
      .notNull()
      .default("pi"),

    status: text("status")
      .notNull()
      .default("pending"),

    amount: numeric("amount", {
      precision: 18,
      scale: 6,
    }).notNull(),

    currency: text("currency")
      .notNull()
      .default("Pi"),

    provider: text("provider"),

    providerPaymentId: text(
      "provider_payment_id",
    ),

    providerReference: text(
      "provider_reference",
    ),

    gatewayUrl: text(
      "gateway_url",
    ),

    createdAt: timestamp(
      "created_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),

    updatedAt: timestamp(
      "updated_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow()
      .$onUpdate(
        () => new Date(),
      ),

    paidAt: timestamp(
      "paid_at",
      {
        withTimezone: true,
      },
    ),
  },
);

export const insertPaymentSchema =
  createInsertSchema(
    paymentsTable,
  ).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });

export type InsertPayment =
  z.infer<
    typeof insertPaymentSchema
  >;

export type Payment =
  typeof paymentsTable.$inferSelect;