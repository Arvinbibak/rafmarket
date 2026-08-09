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

const PAYMENT_METHODS: PaymentMethod[] = [
  "pi",
  "irr",
];

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

function parseId(value: unknown): number | null {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

function parsePositiveAmount(
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

/**
 * POST /payments
 *
 * Creates a payment record for an order.
 *
 * Supported methods:
 * - pi  -> Pi Network
 * - irr -> Iranian Rial / future Iranian gateway
 */
router.post(
  "/payments",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const orderId = parseId(
        req.body?.orderId,
      );

      const method =
        typeof req.body?.method === "string"
          ? req.body.method.toLowerCase()
          : "";

      if (
        orderId === null ||
        !PAYMENT_METHODS.includes(
          method as PaymentMethod,
        )
      ) {
        res.status(400).json({
          error:
            "orderId and valid payment method are required",
          allowedMethods: PAYMENT_METHODS,
        });
        return;
      }

      const paymentMethod =
        method as PaymentMethod;

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
          error:
            "Order is not available for payment",
          status: order.status,
        });
        return;
      }

      const currency =
        paymentMethod === "pi"
          ? "Pi"
          : "IRR";

      const provider =
        paymentMethod === "pi"
          ? "pi"
          : null;

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
                paymentMethod,
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
          existing: true,
        });
        return;
      }

      const [payment] = await db
        .insert(paymentsTable)
        .values({
          orderId,
          userId: req.user!.id,
          method: paymentMethod,
          status: "pending",
          amount: order.total,
          currency,
          provider,
        })
        .returning();

      if (!payment) {
        res.status(500).json({
          error:
            "Unable to create payment",
        });
        return;
      }

      if (paymentMethod === "irr") {
        res.status(201).json({
          success: true,
          payment,
          method: "irr",
          currency: "IRR",
          status: "pending",
          gateway: "not_configured",
          message:
            "Iranian payment gateway is not configured yet",
        });
        return;
      }

      res.status(201).json({
        success: true,
        payment,
        method: "pi",
        amount: Number(order.total),
        currency: "Pi",
        status: "pending",
        message:
          "Pi payment created successfully",
      });
    } catch (err) {
      logger.error(
        { err },
        "Create payment failed",
      );

      res.status(500).json({
        error:
          "Unable to create payment",
      });
    }
  },
);

/**
 * POST /payments/pi/initiate
 */
router.post(
  "/payments/pi/initiate",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const orderId = parseId(
        req.body?.orderId,
      );

      const amount = parsePositiveAmount(
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
          error:
            "Order is not available for payment",
          status: order.status,
        });
        return;
      }

      const orderAmount =
        Number(order.total);

      if (
        !Number.isFinite(orderAmount) ||
        amount !== orderAmount
      ) {
        res.status(400).json({
          error:
            "Payment amount does not match order total",
          expectedAmount: orderAmount,
          receivedAmount: amount,
        });
        return;
      }

      if (order.currency !== "Pi") {
        res.status(409).json({
          error:
            "This order is not payable with Pi",
          currency: order.currency,
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
        payment = existingPayment;
      } else {
        const [createdPayment] =
          await db
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

        payment = createdPayment;
      }

      if (!payment) {
        res.status(500).json({
          error:
            "Unable to create Pi payment",
        });
        return;
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
        message:
          "Pi payment initiated",
      });
    } catch (err) {
      logger.error(
        { err },
        "Pi payment initiation failed",
      );

      res.status(500).json({
        error:
          "Unable to initiate Pi payment",
      });
    }
  },
);

/**
 * POST /payments/pi/approve
 */
router.post(
  "/payments/pi/approve",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const paymentId = parseId(
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
          error:
            "Payment is not a Pi payment",
        });
        return;
      }

      if (
        payment.status === "paid"
      ) {
        res.status(409).json({
          error:
            "Payment is already completed",
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
              status:
                response.status,
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

        const [updatedPayment] =
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
            )
            .returning();

        res.json({
          success: true,
          status: "approved",
          paymentId:
            updatedPayment?.id ??
            payment.id,
          piPaymentId,
          data,
        });
      } catch (err) {
        logger.error(
          {
            err,
            piPaymentId,
          },
          "Pi payment approval request failed",
        );

        res.status(502).json({
          error:
            "Unable to connect to Pi Network",
        });
      }
    } catch (err) {
      logger.error(
        { err },
        "Pi payment approval failed",
      );

      res.status(500).json({
        error:
          "Unable to approve Pi payment",
      });
    }
  },
);

/**
 * POST /payments/pi/complete
 */
router.post(
  "/payments/pi/complete",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const paymentId = parseId(
        req.body?.paymentId,
      );

      const piPaymentId =
        typeof req.body?.piPaymentId ===
        "string"
          ? req.body.piPaymentId.trim()
          : "";

      const txid =
        typeof req.body?.txid ===
        "string"
          ? req.body.txid.trim()
          : "";

      if (
        paymentId === null ||
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
          error:
            "Payment is not a Pi payment",
        });
        return;
      }

      if (payment.status === "paid") {
        res.json({
          success: true,
          status: "paid",
          paymentId: payment.id,
          piPaymentId,
          txid,
          orderId: payment.orderId,
          message:
            "Payment is already completed",
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

      const expectedAmount =
        Number(order.total);

      try {
        const verifyResponse =
          await fetch(
            `${PI_API_BASE}/payments/${encodeURIComponent(
              piPaymentId,
            )}`,
            {
              headers:
                getPiHeaders(),
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
              status:
                verifyResponse.status,
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

        const actualAmount =
          Number(paymentData.amount);

        if (
          !Number.isFinite(
            actualAmount,
          ) ||
          actualAmount !==
            expectedAmount
        ) {
          res.status(409).json({
            error:
              "Pi payment amount does not match order",
            expectedAmount,
            actualAmount:
              paymentData.amount,
          });
          return;
        }

        if (
          paymentData.identifier &&
          paymentData.identifier !==
            piPaymentId
        ) {
          res.status(409).json({
            error:
              "Pi payment identifier mismatch",
          });
          return;
        }

        const transactionTxid =
          paymentData.transaction
            ?.txid;

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

        const paymentStatus =
          paymentData.status;

        if (
          paymentStatus?.cancelled ||
          paymentStatus?.user_cancelled
        ) {
          await db
            .update(paymentsTable)
            .set({
              status:
                "cancelled",
              providerPaymentId:
                piPaymentId,
              providerReference:
                txid,
            })
            .where(
              eq(
                paymentsTable.id,
                payment.id,
              ),
            );

          res.status(409).json({
            error:
              "Pi payment was cancelled",
          });
          return;
        }

        if (
          !paymentStatus
            ?.developer_approved ||
          !paymentStatus
            ?.transaction_verified
        ) {
          res.status(409).json({
            error:
              "Pi payment has not been verified",
          });
          return;
        }

        /*
         * Complete the payment on Pi Network.
         */
        const completeResponse =
          await fetch(
            `${PI_API_BASE}/payments/${encodeURIComponent(
              piPaymentId,
            )}/complete`,
            {
              method: "POST",
              headers:
                getPiHeaders(),
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

        if (
          !completeResponse.ok
        ) {
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

        const paidAt =
          new Date();

        await db
          .update(paymentsTable)
          .set({
            status: "paid",
            providerPaymentId:
              piPaymentId,
            providerReference:
              txid,
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
            paymentId:
              payment.id,
            piPaymentId,
            txid,
            orderId:
              order.id,
          },
          "Pi payment completed",
        );

        res.json({
          success: true,
          status: "paid",
          paymentId:
            payment.id,
          piPaymentId,
          txid,
          orderId:
            order.id,
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
    } catch (err) {
      logger.error(
        { err },
        "Complete Pi payment failed",
      );

      res.status(500).json({
        error:
          "Unable to complete Pi payment",
      });
    }
  },
);

/**
 * POST /payments/pi/cancel
 */
router.post(
  "/payments/pi/cancel",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const paymentId = parseId(
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
          error:
            "Payment is not a Pi payment",
        });
        return;
      }

      if (payment.status === "paid") {
        res.status(409).json({
          error:
            "Paid payment cannot be cancelled",
        });
        return;
      }

      try {
        const response =
          await fetch(
            `${PI_API_BASE}/payments/${encodeURIComponent(
              piPaymentId,
            )}/cancel`,
            {
              method: "POST",
              headers:
                getPiHeaders(),
            },
          );

        if (!response.ok) {
          const data =
            await response.text();

          logger.warn(
            {
              status:
                response.status,
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
            status:
              "cancelled",
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
          status:
            "cancelled",
          paymentId:
            payment.id,
          piPaymentId,
        });
      } catch (err) {
        logger.error(
          {
            err,
            piPaymentId,
          },
          "Pi payment cancellation failed",
        );

        res.status(502).json({
          error:
            "Unable to cancel Pi payment",
        });
      }
    } catch (err) {
      logger.error(
        { err },
        "Cancel Pi payment failed",
      );

      res.status(500).json({
        error:
          "Unable to cancel Pi payment",
      });
    }
  },
);

/**
 * POST /payments/irr/initiate
 *
 * Creates an Iranian Rial payment.
 *
 * The actual gateway is intentionally not hard-coded.
 * When a legal Iranian gateway is selected,
 * its API can be connected here using:
 *
 * IRR_GATEWAY_BASE_URL
 * IRR_GATEWAY_API_KEY
 * IRR_GATEWAY_MERCHANT_ID
 */
router.post(
  "/payments/irr/initiate",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const orderId = parseId(
        req.body?.orderId,
      );

      if (orderId === null) {
        res.status(400).json({
          error:
            "Valid orderId is required",
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
              orderId,
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

      if (order.status !== "pending") {
        res.status(409).json({
          error:
            "Order is not available for payment",
          status: order.status,
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
                "irr",
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
          status: "pending",
          gateway:
            "not_configured",
        });
        return;
      }

      /*
       * IMPORTANT:
       * The order total is stored in Pi currently.
       *
       * Until a real IRR pricing/conversion layer
       * is added, we do NOT silently convert Pi to IRR.
       *
       * This endpoint therefore creates the payment
       * record but does not pretend that an Iranian
       * gateway has received the money.
       */
      const [payment] =
        await db
          .insert(paymentsTable)
          .values({
            orderId,
            userId: req.user!.id,
            method: "irr",
            status: "pending",
            amount: order.total,
            currency: "IRR",
            provider: null,
          })
          .returning();

      if (!payment) {
        res.status(500).json({
          error:
            "Unable to create IRR payment",
        });
        return;
      }

      res.status(201).json({
        success: true,
        payment,
        status: "pending",
        currency: "IRR",
        gateway:
          "not_configured",
        message:
          "IRR payment record created. A real Iranian payment gateway must be configured before accepting payment.",
      });
    } catch (err) {
      logger.error(
        { err },
        "IRR payment initiation failed",
      );

      res.status(500).json({
        error:
          "Unable to initiate IRR payment",
      });
    }
  },
);

/**
 * POST /payments/irr/callback
 *
 * Generic callback endpoint for a future Iranian
 * payment gateway.
 *
 * This endpoint does NOT mark a payment as paid
 * unless the request contains a valid payment
 * belonging to the authenticated user.
 *
 * For a real gateway this should be replaced with
 * provider-specific server-to-server verification.
 */
router.post(
  "/payments/irr/callback",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const paymentId = parseId(
        req.body?.paymentId,
      );

      const reference =
        typeof req.body?.reference ===
        "string"
          ? req.body.reference.trim()
          : "";

      if (
        paymentId === null ||
        !reference
      ) {
        res.status(400).json({
          error:
            "paymentId and reference are required",
        });
        return;
      }

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
                req.user!.id,
              ),
            ),
          );

      if (!payment) {
        res.status(404).json({
          error:
            "Payment not found",
        });
        return;
      }

      if (payment.method !== "irr") {
        res.status(400).json({
          error:
            "Payment is not an IRR payment",
        });
        return;
      }

      /*
       * Do not trust a browser callback as proof
       * of payment.
       *
       * A real gateway must be verified here.
       */
      res.status(501).json({
        success: false,
        status:
          payment.status,
        paymentId:
          payment.id,
        message:
          "IRR gateway verification is not configured yet",
      });
    } catch (err) {
      logger.error(
        { err },
        "IRR payment callback failed",
      );

      res.status(500).json({
        error:
          "Unable to process IRR callback",
      });
    }
  },
);

/**
 * GET /payments/:id
 */
router.get(
  "/payments/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    try {
      const id = parseId(
        Array.isArray(req.params.id)
          ? req.params.id[0]
          : req.params.id,
      );

      if (id === null) {
        res.status(400).json({
          error:
            "Invalid payment id",
        });
        return;
      }

      const [payment] =
        await db
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
          error:
            "Payment not found",
        });
        return;
      }

      res.json({
        success: true,
        payment,
      });
    } catch (err) {
      logger.error(
        { err },
        "Get payment failed",
      );

      res.status(500).json({
        error:
          "Unable to get payment",
      });
    }
  },
);

export default router;