import { Router, type IRouter } from "express";
import { db, cartItemsTable, productsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

function buildCartResponse(items: typeof cartItemsTable.$inferSelect[]) {
  const cartItems = items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    price: parseFloat(item.price),
    currency: item.currency,
    quantity: item.quantity,
    imageUrl: item.imageUrl,
  }));

  const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  return { items: cartItems, total, currency: "Pi", itemCount };
}

// GET /cart
router.get("/cart", requireAuth, async (req, res): Promise<void> => {
  const items = await db.select().from(cartItemsTable).where(eq(cartItemsTable.userId, req.user!.id));
  res.json(buildCartResponse(items));
});

// DELETE /cart
router.delete("/cart", requireAuth, async (req, res): Promise<void> => {
  await db.delete(cartItemsTable).where(eq(cartItemsTable.userId, req.user!.id));
  res.sendStatus(204);
});

// POST /cart/items
router.post("/cart/items", requireAuth, async (req, res): Promise<void> => {
  const { productId, quantity } = req.body as { productId?: number; quantity?: number };
  if (!productId || !quantity || quantity < 1) {
    res.status(400).json({ error: "productId and quantity >= 1 required" });
    return;
  }

  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const [existing] = await db.select().from(cartItemsTable).where(
    and(eq(cartItemsTable.userId, req.user!.id), eq(cartItemsTable.productId, productId))
  );

  if (existing) {
    await db.update(cartItemsTable)
      .set({ quantity: existing.quantity + quantity })
      .where(eq(cartItemsTable.id, existing.id));
  } else {
    await db.insert(cartItemsTable).values({
      userId: req.user!.id,
      productId,
      productName: product.name,
      price: product.price,
      currency: product.currency,
      quantity,
      imageUrl: product.imageUrls?.[0] ?? null,
    });
  }

  const items = await db.select().from(cartItemsTable).where(eq(cartItemsTable.userId, req.user!.id));
  res.json(buildCartResponse(items));
});

// PATCH /cart/items/:productId
router.patch("/cart/items/:productId", requireAuth, async (req, res): Promise<void> => {
  const productId = parseInt(Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId, 10);
  const { quantity } = req.body as { quantity?: number };

  if (!quantity || quantity < 1) {
    res.status(400).json({ error: "quantity >= 1 required" });
    return;
  }

  await db.update(cartItemsTable)
    .set({ quantity })
    .where(and(eq(cartItemsTable.userId, req.user!.id), eq(cartItemsTable.productId, productId)));

  const items = await db.select().from(cartItemsTable).where(eq(cartItemsTable.userId, req.user!.id));
  res.json(buildCartResponse(items));
});

// DELETE /cart/items/:productId
router.delete("/cart/items/:productId", requireAuth, async (req, res): Promise<void> => {
  const productId = parseInt(Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId, 10);
  await db.delete(cartItemsTable).where(
    and(eq(cartItemsTable.userId, req.user!.id), eq(cartItemsTable.productId, productId))
  );
  const items = await db.select().from(cartItemsTable).where(eq(cartItemsTable.userId, req.user!.id));
  res.json(buildCartResponse(items));
});

export default router;
