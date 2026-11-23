import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  json,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ordersTable } from "./orders.js";
import { usersTable } from "./users.js";

export type SellerOrderItem = {
  productId: number;
  productName: string;
  price: number;
  currency: string;
  quantity: number;
  imageUrl: string | null;
};

export const sellerOrdersTable = pgTable(
  "seller_orders",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id),
    sellerId: integer("seller_id")
      .notNull()
      .references(() => usersTable.id),
    items: json("items").notNull().$type<SellerOrderItem[]>(),
    subtotal: numeric("subtotal", { precision: 18, scale: 6 }).notNull(),
    commissionPercent: numeric("commission_percent", { precision: 8, scale: 4 }).notNull(),
    commissionAmount: numeric("commission_amount", { precision: 18, scale: 6 }).notNull(),
    sellerAmount: numeric("seller_amount", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull().default("Pi"),
    status: text("status").notNull().default("pending"),
    trackingNumber: text("tracking_number"),
    shippingCarrier: text("shipping_carrier"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    disputeReason: text("dispute_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    orderSellerUnique: uniqueIndex("seller_orders_order_seller_unique").on(
      table.orderId,
      table.sellerId,
    ),
  }),
);

export type SellerOrder = typeof sellerOrdersTable.$inferSelect;
