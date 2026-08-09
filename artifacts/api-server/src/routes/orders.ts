import { Router, type IRouter } from "express";
import {
  db,
  ordersTable,
  cartItemsTable,
  productsTable,
  usersTable,
} from "@workspace/db";
import {
  eq,
  and,
  inArray,
} from "drizzle-orm";
import {
  requireAuth,
  requireAdmin,
} from "../middlewares/auth";

const router: IRouter = Router();

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
    piTxid: row.piTxid,
    shippingAddress:
      row.shippingAddress,
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
        error: "Invalid order status",
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

    const rows = await db
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

// POST /orders
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

    const method: PaymentMethod =
      paymentMethod === "irr"
        ? "irr"
        : "pi";

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
          (item) =>
            item.productId,
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

    for (const cartItem of cartItems) {
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
        product.status !== "active"
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

      items.push({
        productId:
          product.id,
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
      });
      return;
    }

    const productCurrency =
      currencies[0];

    if (
      method === "pi" &&
      productCurrency !== "Pi"
    ) {
      res.status(409).json({
        error:
          "Pi payment requires Pi products",
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
      });
      return;
    }

    const total =
      items.reduce(
        (sum, item) =>
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

    const [order] =
      await db
        .insert(ordersTable)
        .values({
          userId:
            req.user!.id,
          items,
          total:
            total.toFixed(6),
          currency:
            productCurrency,
          paymentMethod:
            method,
          status:
            "pending",
          shippingAddress:
            safeShippingAddress,
          notes:
            safeNotes,
        })
        .returning();

    if (!order) {
      res.status(500).json({
        error:
          "Failed to create order",
      });
      return;
    }

    // Clear cart only after
    // successful order creation.
    await db
      .delete(cartItemsTable)
      .where(
        eq(
          cartItemsTable.userId,
          req.user!.id,
        ),
      );

    // Reduce stock.
    for (const item of items) {
      const product =
        productMap.get(
          item.productId,
        );

      if (!product) {
        continue;
      }

      const newStock =
        product.stock -
        item.quantity;

      await db
        .update