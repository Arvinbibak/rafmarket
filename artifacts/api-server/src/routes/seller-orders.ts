import { Router, type IRouter, type Request, type Response } from "express";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq } from "drizzle-orm";
import { db, ordersTable, sellerOrdersTable, usersTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();
const buyerUsers = alias(usersTable, "seller_order_buyers");
const sellerUsers = alias(usersTable, "seller_order_sellers");

function parseId(value: string | string[] | undefined): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sellerOrderView(row: typeof sellerOrdersTable.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    sellerId: row.sellerId,
    items: row.items,
    subtotal: Number(row.subtotal),
    commissionPercent: Number(row.commissionPercent),
    commissionAmount: Number(row.commissionAmount),
    sellerAmount: Number(row.sellerAmount),
    currency: row.currency,
    status: row.status,
    trackingNumber: row.trackingNumber,
    shippingCarrier: row.shippingCarrier,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    disputeReason: row.disputeReason,
    disputeOpenedAt: row.disputeOpenedAt,
    disputeResolvedAt: row.disputeResolvedAt,
    disputeResolution: row.disputeResolution,
    disputeAdminNote: row.disputeAdminNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* Seller: list only packages assigned to the signed-in seller. */
router.get("/seller/orders", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select({
      sellerOrder: sellerOrdersTable,
      parentOrder: ordersTable,
      buyerUsername: buyerUsers.piUsername,
    })
    .from(sellerOrdersTable)
    .innerJoin(ordersTable, eq(sellerOrdersTable.orderId, ordersTable.id))
    .leftJoin(buyerUsers, eq(ordersTable.userId, buyerUsers.id))
    .where(eq(sellerOrdersTable.sellerId, req.user!.id))
    .orderBy(desc(sellerOrdersTable.createdAt));

  res.json(rows.map(({ sellerOrder, parentOrder, buyerUsername }) => ({
    ...sellerOrderView(sellerOrder),
    buyerUsername: buyerUsername ?? null,
    shippingAddress: parentOrder.shippingAddress,
    orderCreatedAt: parentOrder.createdAt,
  })));
});

/* Seller: enter shipment information. This does not release funds. */
router.patch("/seller/orders/:id/ship", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid seller order id" });
    return;
  }

  const { trackingNumber, shippingCarrier } = req.body as {
    trackingNumber?: unknown;
    shippingCarrier?: unknown;
  };
  const tracking = typeof trackingNumber === "string" ? trackingNumber.trim() : "";
  const carrier = typeof shippingCarrier === "string" ? shippingCarrier.trim() : "";

  if (!tracking || tracking.length > 120) {
    res.status(400).json({ error: "A tracking number of 1–120 characters is required" });
    return;
  }
  if (carrier.length > 120) {
    res.status(400).json({ error: "Shipping carrier is too long" });
    return;
  }

  const [existing] = await db
    .select()
    .from(sellerOrdersTable)
    .where(and(
      eq(sellerOrdersTable.id, id),
      eq(sellerOrdersTable.sellerId, req.user!.id),
    ))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Seller order not found" });
    return;
  }
  if (existing.status !== "paid" && existing.status !== "processing") {
    res.status(409).json({ error: "Only paid or processing packages can be marked as shipped" });
    return;
  }

  const [updated] = await db
    .update(sellerOrdersTable)
    .set({
      status: "shipped",
      trackingNumber: tracking,
      shippingCarrier: carrier || null,
      shippedAt: new Date(),
    })
    .where(eq(sellerOrdersTable.id, id))
    .returning();

  res.json({ success: true, sellerOrder: sellerOrderView(updated) });
});

/* Buyer: confirm delivery for one seller package. */
router.post("/seller-orders/:id/confirm-delivery", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid seller order id" });
    return;
  }

  const [row] = await db
    .select({ sellerOrder: sellerOrdersTable, parentOrder: ordersTable })
    .from(sellerOrdersTable)
    .innerJoin(ordersTable, eq(sellerOrdersTable.orderId, ordersTable.id))
    .where(and(
      eq(sellerOrdersTable.id, id),
      eq(ordersTable.userId, req.user!.id),
    ))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Seller package not found" });
    return;
  }
  if (row.sellerOrder.status !== "shipped") {
    res.status(409).json({ error: "Only shipped packages can be confirmed as delivered" });
    return;
  }

  const [updated] = await db
    .update(sellerOrdersTable)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(eq(sellerOrdersTable.id, id))
    .returning();

  res.json({
    success: true,
    sellerOrder: sellerOrderView(updated),
    message: "Delivery confirmed. The seller payout has not been sent yet.",
  });
});

/* Buyer: open a dispute against one seller package. */
router.post("/seller-orders/:id/dispute", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid seller order id" });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 2000) {
    res.status(400).json({ error: "Dispute reason must be between 10 and 2000 characters" });
    return;
  }

  const [row] = await db
    .select({ sellerOrder: sellerOrdersTable, parentOrder: ordersTable })
    .from(sellerOrdersTable)
    .innerJoin(ordersTable, eq(sellerOrdersTable.orderId, ordersTable.id))
    .where(and(
      eq(sellerOrdersTable.id, id),
      eq(ordersTable.userId, req.user!.id),
    ))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Seller package not found" });
    return;
  }

  const status = row.sellerOrder.status;
  const deliveredWithinWindow =
    status === "delivered" &&
    row.sellerOrder.deliveredAt != null &&
    Date.now() - row.sellerOrder.deliveredAt.getTime() <= 7 * 24 * 60 * 60 * 1000;

  if (!["paid", "processing", "shipped"].includes(status) && !deliveredWithinWindow) {
    res.status(409).json({ error: "This package is not eligible for a dispute" });
    return;
  }

  const [updated] = await db
    .update(sellerOrdersTable)
    .set({
      status: "disputed",
      disputeReason: reason,
      disputeOpenedAt: new Date(),
      disputeResolution: null,
      disputeResolvedAt: null,
      disputeAdminNote: null,
    })
    .where(eq(sellerOrdersTable.id, id))
    .returning();

  res.status(201).json({
    success: true,
    sellerOrder: sellerOrderView(updated),
    message: "Dispute opened. The package is on hold for administrator review.",
  });
});

/* Admin: review all seller packages, optionally filtered by status. */
router.get("/admin/seller-orders", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const query = db
    .select({
      sellerOrder: sellerOrdersTable,
      sellerUsername: sellerUsers.piUsername,
      buyerUsername: buyerUsers.piUsername,
      parentOrder: ordersTable,
    })
    .from(sellerOrdersTable)
    .innerJoin(ordersTable, eq(sellerOrdersTable.orderId, ordersTable.id))
    .leftJoin(sellerUsers, eq(sellerOrdersTable.sellerId, sellerUsers.id))
    .leftJoin(buyerUsers, eq(ordersTable.userId, buyerUsers.id));

  const rows = status
    ? await query.where(eq(sellerOrdersTable.status, status)).orderBy(desc(sellerOrdersTable.createdAt))
    : await query.orderBy(desc(sellerOrdersTable.createdAt));

  res.json(rows.map(({ sellerOrder, sellerUsername, buyerUsername, parentOrder }) => ({
    ...sellerOrderView(sellerOrder),
    sellerUsername: sellerUsername ?? null,
    buyerUsername: buyerUsername ?? null,
    shippingAddress: parentOrder.shippingAddress,
  })));
});

/* Admin: record a dispute decision. This endpoint does not move Pi. */
router.patch("/admin/seller-orders/:id/dispute", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid seller order id" });
    return;
  }

  const { resolution, note } = req.body as { resolution?: unknown; note?: unknown };
  if (resolution !== "release_to_seller" && resolution !== "refund_to_buyer") {
    res.status(400).json({ error: "Resolution must be release_to_seller or refund_to_buyer" });
    return;
  }
  if (note != null && typeof note !== "string") {
    res.status(400).json({ error: "Admin note must be a string" });
    return;
  }
  if (typeof note === "string" && note.trim().length > 2000) {
    res.status(400).json({ error: "Admin note is too long" });
    return;
  }

  const [existing] = await db
    .select()
    .from(sellerOrdersTable)
    .where(eq(sellerOrdersTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Seller order not found" });
    return;
  }
  if (existing.status !== "disputed") {
    res.status(409).json({ error: "Only disputed packages can be resolved" });
    return;
  }

  const [updated] = await db
    .update(sellerOrdersTable)
    .set({
      status: "dispute_resolved",
      disputeResolution: resolution,
      disputeAdminNote: typeof note === "string" ? note.trim() || null : null,
      disputeResolvedAt: new Date(),
    })
    .where(eq(sellerOrdersTable.id, id))
    .returning();

  res.json({
    success: true,
    sellerOrder: sellerOrderView(updated),
    message: "Decision recorded only. No Pi has been transferred or refunded.",
  });
});

export default router;
