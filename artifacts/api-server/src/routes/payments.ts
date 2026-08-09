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

type PaymentMethod = "pi" | "irr";

const PI_API_BASE = "https://api.minepi.com/v2";

function getPiHeaders(): Record<string, string> {
  const apiKey = process.env.PI_API_KEY;

  if (!apiKey) {
    throw new Error("PI_API_KEY is not configured");
  }

  return {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// POST /payments
router.post(
  "/payments",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      orderId,
      method,
    } = req.body as {
      orderId?: number;
      method?: PaymentMethod;
    };

    if (
      !Number.isInteger(orderId) ||
      !method ||
      !["pi", "irr"].includes(method)
    ) {
      res.status(400).json({
        error: "orderId and valid payment method are required",
        allowedMethods: ["pi", "irr"],
      });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, orderId),
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

    if (order.status !== "pending") {
      res.status(409).json({
        error: "Order is not available for payment",
        status: order.status,
      });
      return;
    }

    const currency =
      method === "pi"
        ? "Pi"
        : "IRR";

    const provider =
      method === "pi"
        ? "pi"
        : null;

    const [existingPayment] = await db
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
        payment: existingPayment,
      });
      return;
    }

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        orderId,
        userId: req.user!.id,
        method,
        status: "pending",
        amount: order.total,
        currency,
        provider,
      })
      .returning();

    if (method === "irr") {
      res.status(201).json({
        success: true,
        payment,
        message:
          "Iranian payment gateway is ready to be connected",
      });
      return;
    }

    res.status(201).json({
      success: true,
      payment,
      amount: Number(order.total),
      currency: "Pi",
      message: "Pi payment ready",
    });
  },
);

// POST /payments/pi/initiate
router.post(
  "/payments/pi/initiate",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      orderId,
      amount,
    } = req.body as {
      orderId?: number;
      amount?: number;
    };

    if (
      !Number.isInteger(orderId) ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      res.status(400).json({
        error:
          "Valid orderId and amount are required",
      });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, orderId),
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

    const orderAmount = Number(order.total);

    if (
      !Number.isFinite(orderAmount) ||
      amount !== orderAmount
    ) {
      res.status(400).json({
        error: "Payment amount does not match order total",
      });
      return;
    }

    if (order.status !== "pending") {
      res.status(409).json({
        error:
          "Order is not available for payment",
      });
      return;
    }

    let payment;

    const [existingPayment] = await db
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
      payment = existingPayment;
    } else {
      [payment] = await db
        .insert(paymentsTable)
        .values({
          orderId,
          userId: req.user!.id,
          method: "pi",
          status: "pending",
          amount: order.total,
          currency: "Pi",
          provider: "pi",
        })
        .returning();
    }

    req.log.info(
      {
        orderId,
        paymentId: payment.id,
        amount,
      },
      "Pi payment initiated",
    );

    res.json({
      success: true,
      status: "initiated",
      paymentId: payment.id,
      piPaymentId:
        payment.providerPaymentId,
      txid: null,
      orderId,
      amount: orderAmount,
      currency: "Pi",
      message: "Pi payment initiated",
    });
  },
);

// POST /payments/pi/approve
router.post(
  "/payments/pi/approve",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      orderId,
      piPaymentId,
    } = req.body as {
      paymentId?: number;
      orderId?: number;
      piPaymentId?: string;
    };

    if (
      !Number.isInteger(paymentId) ||
      !piPaymentId
    ) {
      res.status(400).json({
        error:
          "paymentId and piPaymentId are required",
      });
      return;
    }

    const [payment] = await db
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
            req.user!.id,
          ),
        ),
      );

    if (!payment) {
      res.status(404).json({
        error: "Payment not found",
      });
      return;
    }

    if (payment.method !== "pi") {
      res.status(400).json({
        error: "Payment is not a Pi payment",
      });
      return;
    }

    if (
      orderId &&
      payment.orderId !== orderId
    ) {
      res.status(400).json({
        error:
          "Payment does not belong to this order",
      });
      return;
    }

    try {
      const response = await fetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(
          piPaymentId,
        )}/approve`,
        {
          method: "POST",
          headers: getPiHeaders(),
        },
      );

      const data =
        (await response.json()) as Record<
          string,
          unknown
        >;

      if (!response.ok) {
        logger.warn(
          {
            status: response.status,
            piPaymentId,
            data,
          },
          "Pi payment approval failed",
        );

        res.status(502).json({
          error:
            "Pi payment approval failed",
        });
        return;
      }

      await db
        .update(paymentsTable)
        .set({
          providerPaymentId:
            piPaymentId,
          status: "processing",
        })
        .where(
          eq(
            paymentsTable.id,
            payment.id,
          ),
        );

      res.json({
        success: true,
        status: "approved",
        paymentId: payment.id,
        piPaymentId,
        data,
      });
    } catch (err) {
      logger.error(
        { err, piPaymentId },
        "Pi payment approval request failed",
      );

      res.status(502).json({
        error:
          "Unable to connect to Pi Network",
      });
    }
  },
);

// POST /payments/pi/complete
router.post(
  "/payments/pi/complete",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      piPaymentId,
      txid,
    } = req.body as {
      paymentId?: number;
      piPaymentId?: string;
      txid?: string;
    };

    if (
      !Number.isInteger(paymentId) ||
      !piPaymentId ||
      !txid
    ) {
      res.status(400).json({
        error:
          "paymentId, piPaymentId and txid are required",
      });
      return;
    }

    const [payment] = await db
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
            req.user!.id,
          ),
        ),
      );

    if (!payment) {
      res.status(404).json({
        error: "Payment not found",
      });
      return;
    }

    if (payment.method !== "pi") {
      res.status(400).json({
        error: "Payment is not a Pi payment",
      });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(
            ordersTable.id,
            payment.orderId,
          ),
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

    try {
      // Always verify the payment directly with Pi.
      const verifyResponse = await fetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(
          piPaymentId,
        )}`,
        {
          headers: getPiHeaders(),
        },
      );

      const paymentData =
        (await verifyResponse.json()) as {
          identifier?: string;
          amount?: number;
          status?: {
            developer_approved?: boolean;
            transaction_verified?: boolean;
            developer_completed?: boolean;
            cancelled?: boolean;
            user_cancelled?: boolean;
          };
          transaction?: {
            txid?: string;
          };
        };

      if (!verifyResponse.ok) {
        logger.warn(
          {
            status: verifyResponse.status,
            piPaymentId,
          },
          "Pi payment verification failed",
        );

        res.status(502).json({
          error:
            "Pi payment verification failed",
        });
        return;
      }

      const expectedAmount =
        Number(order.total);

      const actualAmount =
        Number(paymentData.amount);

      if (
        !Number.isFinite(actualAmount) ||
        actualAmount !== expectedAmount
      ) {
        res.status(409).json({
          error:
            "Pi payment amount does not match order",
        });
        return;
      }

      const transactionTxid =
        paymentData.transaction?.txid;

      if (
        transactionTxid &&
        transactionTxid !== txid
      ) {
        res.status(409).json({
          error:
            "Transaction ID does not match Pi payment",
        });
        return;
      }

      const status =
        paymentData.status;

      if (
        status?.cancelled ||
        status?.user_cancelled
      ) {
        await db
          .update(paymentsTable)
          .set({
            status: "cancelled",
            providerPaymentId:
              piPaymentId,
            providerReference: txid,
          })
          .where(
            eq(
              paymentsTable.id,
              payment.id,
            ),
          );

        res.status(409).json({
          error: "Pi payment was cancelled",
        });
        return;
      }

      if (
        !status?.developer_approved ||
        !status?.transaction_verified
      ) {
        res.status(409).json({
          error:
            "Pi payment has not been verified",
        });
        return;
      }

      // Complete the payment on Pi Network.
      const completeResponse =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            piPaymentId,
          )}/complete`,
          {
            method: "POST",
            headers: getPiHeaders(),
            body: JSON.stringify({
              txid,
            }),
          },
        );

      const completeData =
        (await completeResponse.json()) as Record<
          string,
          unknown
        >;

      if (!completeResponse.ok) {
        logger.warn(
          {
            status:
              completeResponse.status,
            piPaymentId,
            completeData,
          },
          "Pi payment completion failed",
        );

        res.status(502).json({
          error:
            "Pi payment completion failed",
        });
        return;
      }

      const paidAt = new Date();

      await db
        .update(paymentsTable)
        .set({
          status: "paid",
          providerPaymentId:
            piPaymentId,
          providerReference: txid,
          paidAt,
        })
        .where(
          eq(
            paymentsTable.id,
            payment.id,
          ),
        );

      await db
        .update(ordersTable)
        .set({
          status: "paid",
          piPaymentId,
          piTxid: txid,
        })
        .where(
          and(
            eq(
              ordersTable.id,
              order.id,
            ),
            eq(
              ordersTable.userId,
              req.user!.id,
            ),
          ),
        );

      req.log.info(
        {
          paymentId: payment.id,
          piPaymentId,
          txid,
          orderId: order.id,
        },
        "Pi payment completed",
      );

      res.json({
        success: true,
        status: "paid",
        paymentId: payment.id,
        piPaymentId,
        txid,
        orderId: order.id,
        message:
          "Pi payment verified and completed",
      });
    } catch (err) {
      logger.error(
        {
          err,
          paymentId,
          piPaymentId,
        },
        "Pi payment completion failed",
      );

      res.status(502).json({
        error:
          "Unable to verify or complete Pi payment",
      });
    }
  },
);

// POST /payments/pi/cancel
router.post(
  "/payments/pi/cancel",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      piPaymentId,
    } = req.body as {
      paymentId?: number;
      piPaymentId?: string;
    };

    if (
      !Number.isInteger(paymentId) ||
      !piPaymentId
    ) {
      res.status(400).json({
        error:
          "paymentId and piPaymentId are required",
      });
      return;
    }

    const [payment] = await db
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
            req.user!.id,
          ),
        ),
      );

    if (!payment) {
      res.status(404).json({
        error: "Payment not found",
      });
      return;
    }

    try {
      const response = await fetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(
          piPaymentId,
        )}/cancel`,
        {
          method: "POST",
          headers: getPiHeaders(),
        },
      );

      if (!response.ok) {
        const data = await response.text();

        logger.warn(
          {
            status: response.status,
            piPaymentId,
            data,
          },
          "Pi payment cancellation failed",
        );

        res.status(502).json({
          error:
            "Pi payment cancellation failed",
        });
        return;
      }

      await db
        .update(paymentsTable)
        .set({
          status: "cancelled",
          providerPaymentId:
            piPaymentId,
        })
        .where(
          eq(
            paymentsTable.id,
            payment.id,
          ),
        );

      res.json({
        success: true,
        status: "cancelled",
        paymentId: payment.id,
        piPaymentId,
      });
    } catch (err) {
      logger.error(
        { err, piPaymentId },
        "Pi payment cancellation failed",
      );

      res.status(502).json({
        error:
          "Unable to cancel Pi payment",
      });
    }
  },
);

// GET /payments/:id
router.get(
  "/payments/:id",
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
        error: "Invalid payment id",
      });
      return;
    }

    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(
            paymentsTable.id,
            id,
          ),
          eq(
            paymentsTable.userId,
            req.user!.id,
          ),
        ),
      );

    if (!payment) {
      res.status(404).json({
        error: "Payment not found",
      });
      return;
    }

    res.json({
      success: true,
      payment,
    });
  },
);

export default router;