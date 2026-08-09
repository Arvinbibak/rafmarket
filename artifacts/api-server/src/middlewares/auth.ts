import { Router, type IRouter } from "express";
import {
  db,
  ordersTable,
  paymentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PI_API_BASE = "https://api.minepi.com/v2";

const PAYMENT_METHODS = [
  "pi",
  "irr",
] as const;

type PaymentMethod =
  (typeof PAYMENT_METHODS)[number];

function isPaymentMethod(
  value: unknown,
): value is PaymentMethod {
  return (
    value === "pi" ||
    value === "irr"
  );
}

function getPiHeaders(): Record<
  string,
  string
> {
  const apiKey =
    process.env.PI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "PI_API_KEY is not configured",
    );
  }

  return {
    Authorization: `Key ${apiKey}`,
    "Content-Type":
      "application/json",
  };
}

function parseId(
  value: unknown,
): number | null {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

function parseAmount(
  value: unknown,
): number | null {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return amount;
}

async function getUserOrder(
  orderId: number,
  userId: number,
) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(
          ordersTable.id,
          orderId,
        ),
        eq(
          ordersTable.userId,
          userId,
        ),
      ),
    );

  return order;
}

async function getUserPayment(
  paymentId: number,
  userId: number,
) {
  const [payment] =
    await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(
            paymentsTable.id,
            paymentId,
          ),
          eq(
            paymentsTable.userId,
            userId,
          ),
        ),
      );

  return payment;
}

/*
 * POST /payments
 *
 * Creates a payment record for an existing order.
 *
 * Pi:
 *   Creates a pending Pi payment record.
 *
 * IRR:
 *   Creates a pending Iranian Rial payment record.
 *   A local gateway can be connected later.
 */
router.post(
  "/payments",
  requireAuth,
  async (
    req,
    res,
  ): Promise<void> => {
    const orderId =
      parseId(
        req.body?.orderId,
      );

    const method =
      req.body?.method;

    if (
      orderId === null ||
      !isPaymentMethod(method)
    ) {
      res.status(400).json({
        error:
          "orderId and valid payment method are required",
        allowedMethods:
          PAYMENT_METHODS,
      });
      return;
    }

    const order =
      await getUserOrder(
        orderId,
        req.user!.id,
      );

    if (!order) {
      res.status(404).json({
        error:
          "Order not found",
      });
      return;
    }

    if (
      order.status !==
      "pending"
    ) {
      res.status(409).json({
        error:
          "Order is not available for payment",
        status:
          order.status,
      });
      return;
    }

    const expectedCurrency =
      method === "pi"
        ? "Pi"
        : "IRR";

    if (
      order.currency !==
      expectedCurrency
    ) {
      res.status(409).json({
        error:
          "Payment method does not match order currency",
        orderCurrency:
          order.currency,
        expectedCurrency,
      });
      return;
    }

    const [existingPayment] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(
              paymentsTable.orderId,
              orderId,
            ),
            eq(
              paymentsTable.userId,
              req.user!.id,
            ),
            eq(
              paymentsTable.method,
              method,
            ),
            eq(
              paymentsTable.status,
              "pending",
            ),
          ),
        );

    if (existingPayment) {
      res.json({
        success: true,
        payment:
          existingPayment,
      });
      return;
    }

    const [payment] =
      await db
        .insert(paymentsTable)
        .values({
          orderId,
          userId:
            req.user!.id,
          method,
          status:
            "pending",
          amount:
            order.total,
          currency:
            expectedCurrency,
          provider:
            method === "pi"
              ? "pi"
              : null,
        })
        .returning();

    if (!payment) {
      res.status(500).json({
        error:
          "Failed to create payment",
      });
      return;
    }

    res.status(201).json({
      success: true,
      payment,
      message:
        method === "pi"
          ? "Pi payment is ready"
          : "Iranian payment is ready for gateway processing",
    });
  },
);

/*
 * GET /payments/:id
 */
router.get(
  "/payments/:id",
  requireAuth,
  async (
    req,
    res,
  ): Promise<void> => {
    const paymentId =
      parseId(
        req.params.id,
      );

    if (paymentId === null) {
      res.status(400).json({
        error:
          "Invalid payment id",
      });
      return;
    }

    const payment =
      await getUserPayment(
        paymentId,
        req.user!.id,
      );

    if (!payment) {
      res.status(404).json({
        error:
          "Payment not found",
      });
      return;
    }

    res.json({
      success: true,
      payment,
    });
  },
);

/*
 * POST /payments/pi/initiate
 *
 * Prepares a Pi payment.
 */
router.post(
  "/payments/pi/initiate",
  requireAuth,
  async (
    req,
    res,
  ): Promise<void> => {
    const orderId =
      parseId(
        req.body?.orderId,
      );

    const amount =
      parseAmount(
        req.body?.amount,
      );

    if (
      orderId === null ||
      amount === null
    ) {
      res.status(400).json({
        error:
          "Valid orderId and amount are required",
      });
      return;
    }

    const order =
      await getUserOrder(
        orderId,
        req.user!.id,
      );

    if (!order) {
      res.status(404).json({
        error:
          "Order not found",
      });
      return;
    }

    if (
      order.currency !==
      "Pi"
    ) {
      res.status(409).json({
        error:
          "Order currency is not Pi",
      });
      return;
    }

    if (
      order.status !==
      "pending"
    ) {
      res.status(409).json({
        error:
          "Order is not available for payment",
      });
      return;
    }

    const orderAmount =
      Number(order.total);

    if (
      !Number.isFinite(
        orderAmount,
      ) ||
      amount !== orderAmount
    ) {
      res.status(400).json({
        error:
          "Payment amount does not match order total",
      });
      return;
    }

    let payment;

    const [existingPayment] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(
              paymentsTable.orderId,
              orderId,
            ),
            eq(
              paymentsTable.userId,
              req.user!.id,
            ),
            eq(
              paymentsTable.method,
              "pi",
            ),
            eq(
              paymentsTable.status,
              "pending",
            ),
          ),
        );

    if (existingPayment) {
      payment =
        existingPayment;
    } else {
      const [createdPayment] =
        await db
          .insert(
            paymentsTable,
          )
          .values({
            orderId,
            userId:
              req.user!.id,
            method:
              "pi",
            status:
              "pending",
            amount:
              order.total,
            currency:
              "Pi",
            provider:
              "pi",
          })
          .returning();

      payment =
        createdPayment;
    }

    if (!payment) {
      res.status(500).json({
        error:
          "Failed to create Pi payment",
      });
      return;
    }

    req.log.info(
      {
        orderId,
        paymentId:
          payment.id,
        amount:
          orderAmount,
      },
      "Pi payment initiated",
    );

    res.json({
      success: true,
      status:
        "initiated",
      paymentId:
        payment.id,
      piPaymentId:
        payment.providerPaymentId ??
        null,
      txid: null,
      orderId,
      amount:
        orderAmount,
      currency:
        "Pi",
      message:
        "Pi payment initiated",
    });
  },
);

/*
 * POST /payments/pi/approve
 *
 * Approves the Pi payment on Pi Network.
 */
router.post(
  "/payments/pi/approve",
  requireAuth,
  async (
    req,
    res,
  ): Promise<void> => {
    const paymentId =
      parseId(
        req.body?.paymentId,
      );

    const piPaymentId =
      typeof req.body?.piPaymentId ===
      "string"
        ? req.body.piPaymentId.trim()
        : "";

    if (
      paymentId === null ||
      !piPaymentId
    ) {
      res.status(400).json({
        error:
          "paymentId and piPaymentId are required",
      });
      return;
    }

    const payment =
      await getUserPayment(
        paymentId,
        req.user!.id,
      );

    if (!payment) {
      res.status(404).json({
        error:
          "Payment not found",
      });
      return;
    }

    if (
      payment.method !==
      "pi"
    ) {
      res.status(400).json({
        error:
          "Payment is not a Pi payment",
      });
      return;
    }

    if (
      payment.status !==
        "pending" &&
      payment.status !==
        "processing"
    ) {
      res.status(409