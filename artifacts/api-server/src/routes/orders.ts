import { Router, type IRouter } from "express";
import {
  db,
  ordersTable,
  sellerOrdersTable,
  platformSettingsTable,
  cartItemsTable,
  productsTable,
  usersTable,
} from "@workspace/db";
import {
  eq,
  and,
  inArray,
  gte,
  sql,
} from "drizzle-orm";
import {
  requireAuth,
  requireAdmin,
} from "../middlewares/auth.js";

const router: IRouter = Router();

// Seller suborders snapshot each seller's share at the moment the parent order is created.

const ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "completed",
  "cancelled",
] as const;

type OrderStatus =
  (typeof ORDER_STATUSES)[number];

const PAYMENT_METHODS = [
  "pi",
  "irr",
] as const;

type PaymentMethod =
  (typeof PAYMENT_METHODS)[number];

type OrderItem = {
  productId: number;
  sellerId?: number;
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
  const items =
    (row.items as OrderItem[]) ?? [];

  return {
    id: row.id,
    userId: row.userId,
    buyerUsername:
      buyerUsername ?? null,
    items,
    total: Number(row.total),
    currency: row.currency,
    paymentMethod:
      row.paymentMethod,
    status: row.status,
    piPaymentId:
      row.piPaymentId,
    piTxid:
      row.piTxid,
    shippingAddress:
      row.shippingAddress,
    notes:
      row.notes,
    createdAt:
      row.createdAt,
    updatedAt:
      row.updatedAt,
  };
}


async function toOrderWithSellerOrders(
  row: typeof ordersTable.$inferSelect,
  buyerUsername?: string | null,
) {
  const sellerRows = await db
    .select({
      sellerOrder: sellerOrdersTable,
      sellerUsername: usersTable.piUsername,
    })
    .from(sellerOrdersTable)
    .leftJoin(usersTable, eq(sellerOrdersTable.sellerId, usersTable.id))
    .where(eq(sellerOrdersTable.orderId, row.id));

  return {
    ...toOrder(row, buyerUsername),
    sellerOrders: sellerRows.map(({ sellerOrder, sellerUsername }) => ({
      id: sellerOrder.id,
      sellerId: sellerOrder.sellerId,
      sellerUsername: sellerUsername ?? null,
      items: sellerOrder.items,
      subtotal: Number(sellerOrder.subtotal),
      currency: sellerOrder.currency,
      status: sellerOrder.status,
      trackingNumber: sellerOrder.trackingNumber,
      shippingCarrier: sellerOrder.shippingCarrier,
      disputeReason: sellerOrder.disputeReason,
      disputeResolution: sellerOrder.disputeResolution,
    })),
  };
}

/* =========================================================
   GET /orders
   ========================================================= */

router.get(
  "/orders",
  requireAuth,
  async (req, res): Promise<void> => {
    const { status } =
      req.query as {
        status?: string;
      };

    if (
      status &&
      !ORDER_STATUSES.includes(
        status as OrderStatus,
      )
    ) {
      res.status(400).json({
        error:
          "Invalid order status",
        allowedStatuses:
          ORDER_STATUSES,
      });
      return;
    }

    const conditions = [
      eq(
        ordersTable.userId,
        req.user!.id,
      ),
    ];

    if (status) {
      conditions.push(
        eq(
          ordersTable.status,
          status,
        ),
      );
    }

    const rows =
      await db
        .select()
        .from(ordersTable)
        .where(
          and(...conditions),
        );

    res.json(
      rows.map((row) =>
        toOrder(
          row,
          req.user!.piUsername,
        ),
      ),
    );
  },
);

/* =========================================================
   POST /orders
   ========================================================= */

router.post(
  "/orders",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      shippingAddress,
      notes,
      paymentMethod,
    } = req.body as {
      shippingAddress?: unknown;
      notes?: unknown;
      paymentMethod?: unknown;
    };

    if (
      shippingAddress != null &&
      typeof shippingAddress !==
        "string"
    ) {
      res.status(400).json({
        error:
          "shippingAddress must be a string",
      });
      return;
    }

    if (
      notes != null &&
      typeof notes !== "string"
    ) {
      res.status(400).json({
        error:
          "notes must be a string",
      });
      return;
    }

    if (
      typeof paymentMethod !==
        "string" ||
      !PAYMENT_METHODS.includes(
        paymentMethod as PaymentMethod,
      )
    ) {
      res.status(400).json({
        error:
          "Invalid payment method",
        allowedMethods:
          PAYMENT_METHODS,
      });
      return;
    }

    const method =
      paymentMethod as PaymentMethod;

    const safeShippingAddress =
      typeof shippingAddress ===
      "string"
        ? shippingAddress.trim()
        : null;

    const safeNotes =
      typeof notes === "string"
        ? notes.trim()
        : null;

    if (
      safeShippingAddress &&
      safeShippingAddress.length >
        2000
    ) {
      res.status(400).json({
        error:
          "shippingAddress is too long",
      });
      return;
    }

    if (
      safeNotes &&
      safeNotes.length > 2000
    ) {
      res.status(400).json({
        error:
          "notes is too long",
      });
      return;
    }

    const cartItems =
      await db
        .select()
        .from(cartItemsTable)
        .where(
          eq(
            cartItemsTable.userId,
            req.user!.id,
          ),
        );

    if (
      cartItems.length === 0
    ) {
      res.status(400).json({
        error:
          "Cart is empty",
      });
      return;
    }

    const productIds = [
      ...new Set(
        cartItems.map(
          (item) =>
            item.productId,
        ),
      ),
    ];

    const products =
      await db
        .select()
        .from(productsTable)
        .where(
          inArray(
            productsTable.id,
            productIds,
          ),
        );

    const productMap =
      new Map(
        products.map(
          (product) => [
            product.id,
            product,
          ],
        ),
      );

    const items: OrderItem[] = [];

    for (
      const cartItem of cartItems
    ) {
      const product =
        productMap.get(
          cartItem.productId,
        );

      if (!product) {
        res.status(409).json({
          error:
            "A product in your cart no longer exists",
          productId:
            cartItem.productId,
        });
        return;
      }

      if (
        product.status !==
        "active"
      ) {
        res.status(409).json({
          error:
            "A product in your cart is no longer available",
          productId:
            product.id,
          productName:
            product.name,
        });
        return;
      }

      if (
        !Number.isInteger(
          cartItem.quantity,
        ) ||
        cartItem.quantity < 1
      ) {
        res.status(409).json({
          error:
            "Invalid quantity in cart",
          productId:
            product.id,
        });
        return;
      }

      if (
        cartItem.quantity >
        product.stock
      ) {
        res.status(409).json({
          error:
            "Requested quantity exceeds available stock",
          productId:
            product.id,
          productName:
            product.name,
          stock:
            product.stock,
        });
        return;
      }

      const price =
        Number(product.price);

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        res.status(409).json({
          error:
            "Product has an invalid price",
          productId:
            product.id,
        });
        return;
      }

      if (
        product.currency !==
          "Pi" &&
        product.currency !==
          "IRR"
      ) {
        res.status(409).json({
          error:
            "Product has an unsupported currency",
          productId:
            product.id,
          currency:
            product.currency,
        });
        return;
      }

      items.push({
        productId:
          product.id,
        sellerId:
          product.sellerId,
        productName:
          product.name,
        price,
        currency:
          product.currency,
        quantity:
          cartItem.quantity,
        imageUrl:
          product.imageUrls?.[0] ??
          null,
      });
    }

    /* -----------------------------------------------------
       Make sure all products use exactly one currency.
       ----------------------------------------------------- */

    const currencies = [
      ...new Set(
        items.map(
          (item) =>
            item.currency,
        ),
      ),
    ];

    if (
      currencies.length !== 1
    ) {
      res.status(409).json({
        error:
          "All order items must use the same currency",
        currencies,
      });
      return;
    }

    const productCurrency =
      currencies[0];

    /* -----------------------------------------------------
       Payment method must match product currency.
       ----------------------------------------------------- */

    if (
      method === "pi" &&
      productCurrency !== "Pi"
    ) {
      res.status(409).json({
        error:
          "Pi payment requires Pi products",
        paymentMethod:
          method,
        currency:
          productCurrency,
      });
      return;
    }

    if (
      method === "irr" &&
      productCurrency !== "IRR"
    ) {
      res.status(409).json({
        error:
          "IRR payment requires IRR products",
        paymentMethod:
          method,
        currency:
          productCurrency,
      });
      return;
    }

    const total =
      items.reduce(
        (
          sum,
          item,
        ) =>
          sum +
          item.price *
            item.quantity,
        0,
      );

    if (
      !Number.isFinite(total) ||
      total <= 0
    ) {
      res.status(409).json({
        error:
          "Invalid order total",
      });
      return;
    }

    /* -----------------------------------------------------
       Create order.
       ----------------------------------------------------- */

    const [commissionSetting] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "commission_percent"))
      .limit(1);
    const commissionPercent = commissionSetting
      ? Number(commissionSetting.value)
      : 5;

    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 30) {
      res.status(500).json({ error: "Marketplace commission setting is invalid" });
      return;
    }

    const itemsBySeller = new Map<number, OrderItem[]>();
    for (const item of items) {
      if (!item.sellerId) {
        res.status(409).json({
          error: "A product is missing its seller",
          productId: item.productId,
        });
        return;
      }
      const sellerItems = itemsBySeller.get(item.sellerId) ?? [];
      sellerItems.push(item);
      itemsBySeller.set(item.sellerId, sellerItems);
    }

    let order: typeof ordersTable.$inferSelect | null;
    try {
      order = await db.transaction(async (tx) => {
        // Reserve every product atomically with order creation. A concurrent checkout
        // cannot oversell stock, and any failed reservation rolls the whole transaction back.
        for (const item of items) {
          const [reserved] = await tx
            .update(productsTable)
            .set({
              stock: sql`${productsTable.stock} - ${item.quantity}`,
              status: sql<string>`CASE WHEN ${productsTable.stock} - ${item.quantity} <= 0 THEN 'sold_out' ELSE 'active' END`,
            })
            .where(and(
              eq(productsTable.id, item.productId),
              eq(productsTable.status, "active"),
              gte(productsTable.stock, item.quantity),
            ))
            .returning({ id: productsTable.id });

          if (!reserved) {
            throw new Error("STOCK_RESERVATION_FAILED");
          }
        }

        const [createdOrder] = await tx
          .insert(ordersTable)
          .values({
            userId: req.user!.id,
            items,
            total: total.toFixed(6),
            currency: productCurrency,
            paymentMethod: method,
            status: "pending",
            shippingAddress: safeShippingAddress,
            notes: safeNotes,
          })
          .returning();

        if (!createdOrder) return null;

        for (const [sellerId, sellerItems] of itemsBySeller) {
          const subtotal = sellerItems.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0,
          );
          const commissionAmount = Math.round(
            subtotal * commissionPercent / 100 * 1_000_000,
          ) / 1_000_000;
          const sellerAmount = Math.round(
            (subtotal - commissionAmount) * 1_000_000,
          ) / 1_000_000;

          await tx.insert(sellerOrdersTable).values({
            orderId: createdOrder.id,
            sellerId,
            items: sellerItems.map(({ sellerId: _sellerId, ...item }) => item),
            subtotal: subtotal.toFixed(6),
            commissionPercent: commissionPercent.toFixed(4),
            commissionAmount: commissionAmount.toFixed(6),
            sellerAmount: sellerAmount.toFixed(6),
            currency: productCurrency,
            status: "pending",
          });
        }

        return createdOrder;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "STOCK_RESERVATION_FAILED") {
        res.status(409).json({
          error: "Product stock changed during checkout. Please refresh your cart and try again.",
        });
        return;
      }
      throw error;
    }

    if (!order) {
      res.status(500).json({
        error: "Failed to create order",
      });
      return;
    }

    /* -----------------------------------------------------
       Clear cart only after order creation and stock reservation.
       ----------------------------------------------------- */

    await db
      .delete(cartItemsTable)
      .where(
        eq(
          cartItemsTable.userId,
          req.user!.id,
        ),
      );

    res.status(201).json(
      await toOrderWithSellerOrders(
        order,
        req.user!.piUsername,
      ),
    );
  },
);

/* =========================================================
   GET /orders/:id
   ========================================================= */

router.get(
  "/orders/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const id =
      parseInt(
        Array.isArray(
          req.params.id,
        )
          ? req.params.id[0]
          : req.params.id,
        10,
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      res.status(400).json({
        error:
          "Invalid order id",
      });
      return;
    }

    const [order] =
      await db
        .select()
        .from(ordersTable)
        .where(
          and(
            eq(
              ordersTable.id,
              id,
            ),
            eq(
              ordersTable.userId,
              req.user!.id,
            ),
          ),
        );

    if (!order) {
      res.status(404).json({
        error:
          "Order not found",
      });
      return;
    }

    res.json(
      await toOrderWithSellerOrders(
        order,
        req.user!.piUsername,
      ),
    );
  },
);

/* =========================================================
   PATCH /orders/:id/status
   Admin only
   ========================================================= */

router.patch(
  "/orders/:id/status",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const id =
      parseInt(
        Array.isArray(
          req.params.id,
        )
          ? req.params.id[0]
          : req.params.id,
        10,
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      res.status(400).json({
        error:
          "Invalid order id",
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
      typeof status !==
        "string" ||
      !ORDER_STATUSES.includes(
        status as OrderStatus,
      )
    ) {
      res.status(400).json({
        error:
          "Invalid order status",
        allowedStatuses:
          ORDER_STATUSES,
      });
      return;
    }

    if (
      notes != null &&
      typeof notes !== "string"
    ) {
      res.status(400).json({
        error:
          "notes must be a string",
      });
      return;
    }

    if (
      typeof notes ===
        "string" &&
      notes.length > 2000
    ) {
      res.status(400).json({
        error:
          "notes is too long",
      });
      return;
    }

    const update:
      Partial<
        typeof ordersTable.$inferInsert
      > = {
      status,
    };

    if (
      typeof notes ===
      "string"
    ) {
      update.notes =
        notes.trim();
    }

    const [order] =
      await db
        .update(ordersTable)
        .set(update)
        .where(
          eq(
            ordersTable.id,
            id,
          ),
        )
        .returning();

    if (!order) {
      res.status(404).json({
        error:
          "Order not found",
      });
      return;
    }

    const [user] =
      await db
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