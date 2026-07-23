import { Router, type IRouter } from "express";
import { db, ordersTable, cartItemsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function toOrder(row: typeof ordersTable.$inferSelect, buyerUsername?: string | null) {
  const items = (row.items as Array<{ productId: number; productName: string; price: number; currency: string; quantity: number; imageUrl: string | null }>) ?? [];
  return {
    id: row.id,
    userId: row.userId,
    buyerUsername: buyerUsername ?? null,
    items,
    total: parseFloat(row.total),
    currency: row.currency,
    status: row.status,
    piPaymentId: row.piPaymentId,
    piTxid: row.piTxid,
    shippingAddress: row.shippingAddress,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /orders
router.get("/orders", requireAuth, async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };
  let rows = await db.select().from(ordersTable).where(eq(ordersTable.userId, req.user!.id));
  if (status) rows = rows.filter((r) => r.status === status);
  res.json(rows.map((r) => toOrder(r, req.user!.piUsername)));
});

// POST /orders
router.post("/orders", requireAuth, async (req, res): Promise<void> => {
  const { shippingAddress, notes } = req.body as { shippingAddress?: string; notes?: string };

  const cartItems = await db.select().from(cartItemsTable).where(eq(cartItemsTable.userId, req.user!.id));
  if (cartItems.length === 0) {
    res.status(400).json({ error: "Cart is empty" });
    return;
  }

  const items = cartItems.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    price: parseFloat(item.price),
    currency: item.currency,
    quantity: item.quantity,
    imageUrl: item.imageUrl,
  }));

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const [order] = await db.insert(ordersTable).values({
    userId: req.user!.id,
    items,
    total: String(total),
    currency: "Pi",
    status: "pending",
    shippingAddress: shippingAddress ?? null,
    notes: notes ?? null,
  }).returning();

  // Clear cart after order
  await db.delete(cartItemsTable).where(eq(cartItemsTable.userId, req.user!.id));

  res.status(201).json(toOrder(order, req.user!.piUsername));
});

// GET /orders/:id
router.get("/orders/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const [order] = await db.select().from(ordersTable).where(
    and(eq(ordersTable.id, id), eq(ordersTable.userId, req.user!.id))
  );

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  res.json(toOrder(order, req.user!.piUsername));
});

// PATCH /orders/:id/status
router.patch("/orders/:id/status", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { status, notes } = req.body as { status?: string; notes?: string };

  if (!status) {
    res.status(400).json({ error: "status required" });
    return;
  }

  const update: Record<string, unknown> = { status };
  if (notes != null) update.notes = notes;

  const [order] = await db.update(ordersTable).set(update).where(eq(ordersTable.id, id)).returning();
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, order.userId));
  res.json(toOrder(order, user?.piUsername));
});

export default router;
