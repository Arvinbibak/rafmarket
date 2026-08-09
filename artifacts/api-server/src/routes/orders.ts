import { Router, type IRouter } from "express";
import {
  db,
  ordersTable,
  cartItemsTable,
  productsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

const ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "completed",
  "cancelled",
] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number];

type OrderItem = {
  productId: number;
  productName: string;
  price: number;
  currency: string;
  quantity: number;
  imageUrl: string | null;
};

function toOrder(
  row: typeof ordersTable.$inferSelect,
  buyerUsername?: string | null,
) {
  const items = (row.items as OrderItem[]) ?? [];

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
router.get(
  "/orders",
  requireAuth,
  async (req, res): Promise<void> => {
    const { status } = req.query as {
      status?: string;
    };

    if (
      status &&
      !ORDER_STATUSES.includes(status as OrderStatus)
    ) {
      res.status(400).json({
        error: "Invalid order status",
        allowedStatuses: ORDER_STATUSES,
      });
      return;
    }

    const conditions = [
      eq(ordersTable.userId, req.user!.id),
    ];

    if (status) {
      conditions.push(
        eq(ordersTable.status, status),
      );
    }

    const rows = await db
      .select()
      .from(ordersTable)
      .where(and(...conditions));

    res.json(
      rows.map((row) =>
        toOrder(row, req.user!.piUsername),
      ),
    );
  },
);

// POST /orders
router.post(
  "/orders",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      shippingAddress,
      notes,
    } = req.body as {
      shippingAddress?: unknown;
      notes?: unknown;
    };

    if (
      shippingAddress != null &&
      typeof shippingAddress !== "string"
    ) {
      res.status(400).json({
        error: "shippingAddress must be a string",
      });
      return;
    }

    if (
      notes != null &&
      typeof notes !== "string"
    ) {
      res.status(400).json({
        error: "notes must be a string",
      });
      return;
    }

    const safeShippingAddress =
      typeof shippingAddress === "string"
        ? shippingAddress.trim()
        : null;

    const safeNotes =
      typeof notes === "string"
        ? notes.trim()
        : null;

    if (
      safeShippingAddress &&
      safeShippingAddress.length > 2000
    ) {
      res.status(400).json({
        error: "shippingAddress is too long",
      });
      return;
    }

    if (
      safeNotes &&
      safeNotes.length > 2000
    ) {
      res.status(400).json({
        error: "notes is too long",
      });
      return;
    }

    const cartItems = await db
      .select()
      .from(cartItemsTable)
      .where(
        eq(
          cartItemsTable.userId,
          req.user!.id,
        ),
      );

    if (cartItems.length === 0) {
      res.status(400).json({
        error: "Cart is empty",
      });
      return;
    }

    const productIds = [
      ...new Set(
        cartItems.map(
          (item) => item.productId,
        ),
      ),
    ];

    const products = await db
      .select()
      .from(productsTable)
      .where(
        inArray(
          productsTable.id,
          productIds,
        ),
      );

    const productMap = new Map(
      products.map((product) => [
        product.id,
        product,
      ]),
    );

    const items: OrderItem[] = [];

    for (const cartItem of cartItems) {
      const product = productMap.get(
        cartItem.productId,
      );

      if (!product) {
        res.status(409).json({
          error:
            "A product in your cart no longer exists",
          productId: cartItem.productId,
        });
        return;
      }

      if (product.status !== "active") {
        res.status(409).json({
          error:
            "A product in your cart is no longer available",
          productId: product.id,
          productName: product.name,
        });
        return;
      }

      if (
        !Number.isInteger(cartItem.quantity) ||
        cartItem.quantity < 1
      ) {
        res.status(409).json({
          error: "Invalid quantity in cart",
          productId: product.id,
        });
        return;
      }

      if (
        cartItem.quantity > product.stock
      ) {
        res.status(409).json({
          error:
            "Requested quantity exceeds available stock",
          productId: product.id,
          productName: product.name,
          stock: product.stock,
        });
        return;
      }

      const price = Number(product.price);

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        res.status(409).json({
          error: "Product has an invalid price",
          productId: product.id,
        });
        return;
      }

      items.push({
        productId: product.id,
        productName: product.name,
        price,
        currency: product.currency,
        quantity: cartItem.quantity,
        imageUrl:
          product.imageUrls?.[0] ?? null,
      });
    }

    const currencies = [
      ...new Set(
        items.map(
          (item) => item.currency,
        ),
      ),
    ];

    if (
      currencies.length !== 1 ||
      currencies[0] !== "Pi"
    ) {
      res.status(409).json({
        error:
          "All order items must use Pi currency",
      });
      return;
    }

    const total = items.reduce(
      (sum, item) =>
        sum + item.price * item.quantity,
      0,
    );

    if (
      !Number.isFinite(total) ||
      total <= 0
    ) {
      res.status(409).json({
        error: "Invalid order total",
      });
      return;
    }

    const [order] = await db
      .insert(ordersTable)
      .values({
        userId: req.user!.id,
        items,
        total: total.toFixed(6),
        currency: "Pi",
        status: "pending",
        shippingAddress:
          safeShippingAddress,
        notes: safeNotes,
      })
      .returning();

    // Clear cart only after order creation succeeds.
    await db
      .delete(cartItemsTable)
      .where(
        eq(
          cartItemsTable.userId,
          req.user!.id,
        ),
      );

    // Reduce stock using the current database value.
    for (const item of items) {
      const product = productMap.get(
        item.productId,
      );

      if (!product) continue;

      const newStock =
        product.stock - item.quantity;

      await db
        .update(productsTable)
        .set({
          stock: newStock,
          status:
            newStock === 0
              ? "sold_out"
              : "active",
        })
        .where(
          and(
            eq(
              productsTable.id,
              item.productId,
            ),
            eq(
              productsTable.stock,
              product.stock,
            ),
          ),
        );
    }

    res.status(201).json(
      toOrder(
        order,
        req.user!.piUsername,
      ),
    );
  },
);

// GET /orders/:id
router.get(
  "/orders/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = parseInt(
      Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id,
      10,
    );

    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({
        error: "Invalid order id",
      });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, id),
          eq(
            ordersTable.userId,
            req.user!.id,
          ),
        ),
      );

    if (!order) {
      res.status(404).json({
        error: "Order not found",
      });
      return;
    }

    res.json(
      toOrder(
        order,
        req.user!.piUsername,
      ),
    );
  },
);

// PATCH /orders/:id/status
// Only administrators can change order status.
router.patch(
  "/orders/:id/status",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = parseInt(
      Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id,
      10,
    );

    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({
        error: "Invalid order id",
      });
      return;
    }

    const {
      status,
      notes,
    } = req.body as {
      status?: unknown;
      notes?: unknown;
    };

    if (
      typeof status !== "string" ||
      !ORDER_STATUSES.includes(
        status as OrderStatus,
      )
    ) {
      res.status(400).json({
        error: "Invalid order status",
        allowedStatuses: ORDER_STATUSES,
      });
      return;
    }

    if (
      notes != null &&
      typeof notes !== "string"
    ) {
      res.status(400).json({
        error: "notes must be a string",
      });
      return;
    }

    if (
      typeof notes === "string" &&
      notes.length > 2000
    ) {
      res.status(400).json({
        error: "notes is too long",
      });
      return;
    }

    const update: Partial<
      typeof ordersTable.$inferInsert
    > = {
      status,
    };

    if (typeof notes === "string") {
      update.notes = notes.trim();
    }

    const [order] = await db
      .update(ordersTable)
      .set(update)
      .where(
        eq(ordersTable.id, id),
      )
      .returning();

    if (!order) {
      res.status(404).json({
        error: "Order not found",
      });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(
        eq(
          usersTable.id,
          order.userId,
        ),
      );

    res.json(
      toOrder(
        order,
        user?.piUsername,
      ),
    );
  },
);

export default router;