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
  const apiKey = process.env["PI_API_KEY"];

  if (!apiKey) {
    throw new Error("PI_API_KEY is not configured");
  }

  return {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function isValidPositiveNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
}

/**
 * POST /payments
 *
 * Creates an internal payment record for an order.
 */
router.post(
  "/payments",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      orderId,
      method,
    } = req.body as {
      orderId?: unknown;
      method?: unknown;
    };

    if (
      !Number.isInteger(orderId) ||
      !["pi", "irr"].includes(
        method as string,
      )
    ) {
      res.status(400).json({
        error:
          "orderId and valid payment method are required",
        allowedMethods: ["pi", "irr"],
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
            orderId as number,
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
              order.id,
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
      });
      return;
    }

    const [payment] =
      await db
        .insert(paymentsTable)
        .values({
          orderId: order.id,
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
          "Failed to create payment",
      });
      return;
    }

    res.status(201).json({
      success: true,
      payment,
      amount: Number(order.total),
      currency,
    });
  },
);

/**
 * POST /payments/pi/initiate
 *
 * Called by Pi SDK:
 *
 * onReadyForServerApproval(paymentId)
 *
 * The paymentId received from the Pi SDK is the Pi payment identifier.
 *
 * This endpoint:
 * 1. Validates the order.
 * 2. Creates/finds our internal payment.
 * 3. Stores the Pi payment identifier.
 * 4. Approves the payment through Pi API.
 */
router.post(
  "/payments/pi/initiate",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      orderId,
      amount,
      paymentId,
    } = req.body as {
      orderId?: unknown;
      amount?: unknown;
      paymentId?: unknown;
    };

    if (
      !Number.isInteger(orderId) ||
      !isValidPositiveNumber(amount) ||
      typeof paymentId !== "string" ||
      !paymentId.trim()
    ) {
      res.status(400).json({
        error:
          "Valid orderId, amount and paymentId are required",
      });
      return;
    }

    const piPaymentId =
      paymentId.trim();

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(
            ordersTable.id,
            orderId as number,
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

    const orderAmount =
      Number(order.total);

    if (
      !Number.isFinite(orderAmount) ||
      orderAmount <= 0
    ) {
      res.status(409).json({
        error:
          "Order has an invalid total",
      });
      return;
    }

    if (
      Math.abs(
        amount - orderAmount,
      ) > 0.000001
    ) {
      res.status(400).json({
        error:
          "Payment amount does not match order total",
        expected: orderAmount,
        received: amount,
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

    let payment:
      | typeof paymentsTable.$inferSelect
      | undefined;

    // First try to find an existing
    // payment for this order.
    const [existingPayment] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(
              paymentsTable.orderId,
              order.id,
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
            orderId: order.id,
            userId: req.user!.id,
            method: "pi",
            status: "pending",
            amount: order.total,
            currency: "Pi",
            provider: "pi",
            providerPaymentId:
              piPaymentId,
          })
          .returning();

      payment = createdPayment;
    }

    if (!payment) {
      res.status(500).json({
        error:
          "Failed to create payment record",
      });
      return;
    }

    // Store the Pi payment ID.
    if (
      payment.providerPaymentId !==
      piPaymentId
    ) {
      const [updatedPayment] =
        await db
          .update(paymentsTable)
          .set({
            providerPaymentId:
              piPaymentId,
          })
          .where(
            eq(
              paymentsTable.id,
              payment.id,
            ),
          )
          .returning();

      if (updatedPayment) {
        payment = updatedPayment;
      }
    }

    req.log.info(
      {
        orderId: order.id,
        paymentId: payment.id,
        piPaymentId,
        amount,
      },
      "Pi payment approval started",
    );

    try {
      /**
       * Server-side Pi approval.
       *
       * Official Pi flow requires the server
       * to approve the payment before the
       * Pioneer can submit the transaction.
       */
      const approveResponse =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            piPaymentId,
          )}/approve`,
          {
            method: "POST",
            headers: getPiHeaders(),
          },
        );

      const approveText =
        await approveResponse.text();

      let approveData: unknown =
        null;

      try {
        approveData =
          approveText
            ? JSON.parse(
                approveText,
              )
            : null;
      } catch {
        approveData =
          approveText;
      }

      if (!approveResponse.ok) {
        logger.warn(
          {
            status:
              approveResponse.status,
            piPaymentId,
            approveData,
          },
          "Pi payment approval failed",
        );

        res.status(502).json({
          error:
            "Pi payment approval failed",
          paymentId: payment.id,
          piPaymentId,
        });
        return;
      }

      await db
        .update(paymentsTable)
        .set({
          status: "processing",
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
        status: "approved",
        paymentId:
          payment.id,
        piPaymentId,
        orderId: order.id,
        amount: orderAmount,
        currency: "Pi",
        data: approveData,
        message:
          "Pi payment approved",
      });
    } catch (err) {
      logger.error(
        {
          err,
          paymentId:
            payment.id,
          piPaymentId,
        },
        "Pi payment approval request failed",
      );

      res.status(502).json({
        error:
          "Unable to connect to Pi Network",
      });
    }
  },
);

/**
 * POST /payments/pi/approve
 *
 * Optional explicit approval endpoint.
 *
 * This is kept for compatibility with
 * existing frontend/API clients.
 */
router.post(
  "/payments/pi/approve",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      orderId,
      piPaymentId,
    } = req.body as {
      paymentId?: unknown;
      orderId?: unknown;
      piPaymentId?: unknown;
    };

    if (
      !Number.isInteger(paymentId) ||
      typeof piPaymentId !==
        "string" ||
      !piPaymentId.trim()
    ) {
      res.status(400).json({
        error:
          "paymentId and piPaymentId are required",
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
              paymentId as number,
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

    if (payment.method !== "pi") {
      res.status(400).json({
        error:
          "Payment is not a Pi payment",
      });
      return;
    }

    if (
      orderId != null &&
      payment.orderId !==
        orderId
    ) {
      res.status(400).json({
        error:
          "Payment does not belong to this order",
      });
      return;
    }

    const cleanPiPaymentId =
      piPaymentId.trim();

    try {
      const response =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            cleanPiPaymentId,
          )}/approve`,
          {
            method: "POST",
            headers: getPiHeaders(),
          },
        );

      const text =
        await response.text();

      let data: unknown = null;

      try {
        data = text
          ? JSON.parse(text)
          : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        logger.warn(
          {
            status:
              response.status,
            piPaymentId:
              cleanPiPaymentId,
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
            cleanPiPaymentId,
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
        paymentId:
          payment.id,
        piPaymentId:
          cleanPiPaymentId,
        data,
      });
    } catch (err) {
      logger.error(
        {
          err,
          piPaymentId:
            cleanPiPaymentId,
        },
        "Pi payment approval request failed",
      );

      res.status(502).json({
        error:
          "Unable to connect to Pi Network",
      });
    }
  },
);

/**
 * POST /payments/pi/complete
 *
 * Called by:
 *
 * onReadyForServerCompletion(paymentId, txid)
 *
 * The paymentId here is the Pi payment identifier
 * returned by the Pi SDK.
 */
router.post(
  "/payments/pi/complete",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      piPaymentId,
      txid,
      orderId,
    } = req.body as {
      paymentId?: unknown;
      piPaymentId?: unknown;
      txid?: unknown;
      orderId?: unknown;
    };

    /*
     * Current Cart.tsx sends:
     *
     * {
     *   paymentId,
     *   txid,
     *   orderId
     * }
     *
     * where paymentId is the Pi payment ID.
     *
     * We also accept piPaymentId for
     * compatibility with older clients.
     */
    const sdkPaymentId =
      typeof paymentId === "string"
        ? paymentId.trim()
        : typeof piPaymentId ===
              "string"
          ? piPaymentId.trim()
          : "";

    if (
      !sdkPaymentId ||
      typeof txid !== "string" ||
      !txid.trim()
    ) {
      res.status(400).json({
        error:
          "paymentId and txid are required",
      });
      return;
    }

    const cleanTxid =
      txid.trim();

    /*
     * Find our local payment record
     * using the Pi payment identifier.
     */
    let payment:
      | typeof paymentsTable.$inferSelect
      | undefined;

    const [byProviderId] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(
              paymentsTable.providerPaymentId,
              sdkPaymentId,
            ),
            eq(
              paymentsTable.userId,
              req.user!.id,
            ),
          ),
        );

    payment =
      byProviderId;

    /*
     * Backward compatibility:
     * if paymentId was sent as a numeric
     * local database ID.
     */
    if (!payment) {
      const numericId =
        Number(sdkPaymentId);

      if (
        Number.isInteger(
          numericId,
        ) &&
        numericId > 0
      ) {
        const [byLocalId] =
          await db
            .select()
            .from(paymentsTable)
            .where(
              and(
                eq(
                  paymentsTable.id,
                  numericId,
                ),
                eq(
                  paymentsTable.userId,
                  req.user!.id,
                ),
              ),
            );

        payment =
          byLocalId;
      }
    }

    if (!payment) {
      res.status(404).json({
        error:
          "Payment not found",
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
      orderId != null &&
      (!Number.isInteger(
        orderId,
      ) ||
        payment.orderId !==
          orderId)
    ) {
      res.status(400).json({
        error:
          "Payment does not belong to this order",
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
        error:
          "Order not found",
      });
      return;
    }

    /*
     * If this payment has already been
     * completed, return success instead
     * of trying to complete it twice.
     */
    if (
      payment.status === "paid" &&
      order.status === "paid"
    ) {
      res.json({
        success: true,
        status: "paid",
        paymentId:
          payment.id,
        piPaymentId:
          payment.providerPaymentId,
        txid:
          payment.providerReference ??
          cleanTxid,
        orderId:
          order.id,
        message:
          "Payment was already completed",
      });
      return;
    }

    try {
      /**
       * Step 1:
       * Retrieve the payment directly
       * from Pi and verify it.
       */
      const verifyResponse =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            sdkPaymentId,
          )}`,
          {
            method: "GET",
            headers: getPiHeaders(),
          },
        );

      const verifyText =
        await verifyResponse.text();

      let paymentData:
        | {
            identifier?: string;
            amount?: number;
            memo?: string;
            metadata?: unknown;
            status?: {
              developer_approved?: boolean;
              transaction_verified?: boolean;
              developer_completed?: boolean;
              cancelled?: boolean;
              user_cancelled?: boolean;
            };
            transaction?: {
              txid?: string;
              verified?: boolean;
            };
          }
        | null = null;

      try {
        paymentData =
          verifyText
            ? (JSON.parse(
                verifyText,
              ) as typeof paymentData)
            : null;
      } catch {
        paymentData = null;
      }

      if (!verifyResponse.ok) {
        logger.warn(
          {
            status:
              verifyResponse.status,
            piPaymentId:
              sdkPaymentId,
            response:
              verifyText,
          },
          "Pi payment verification failed",
        );

        res.status(502).json({
          error:
            "Pi payment verification failed",
        });
        return;
      }

      if (!paymentData) {
        res.status(502).json({
          error:
            "Invalid response from Pi Network",
        });
        return;
      }

      /**
       * Confirm that the returned Pi payment
       * identifier is the one we expected.
       */
      if (
        paymentData.identifier &&
        paymentData.identifier !==
          sdkPaymentId
      ) {
        res.status(409).json({
          error:
            "Pi payment identifier does not match",
        });
        return;
      }

      /**
       * Confirm payment amount.
       */
      const expectedAmount =
        Number(order.total);

      const actualAmount =
        Number(
          paymentData.amount,
        );

      if (
        !Number.isFinite(
          actualAmount,
        ) ||
        Math.abs(
          actualAmount -
            expectedAmount,
        ) > 0.000001
      ) {
        logger.warn(
          {
            orderId:
              order.id,
            expectedAmount,
            actualAmount,
            piPaymentId:
              sdkPaymentId,
          },
          "Pi payment amount mismatch",
        );

        res.status(409).json({
          error:
            "Pi payment amount does not match order",
          expected:
            expectedAmount,
          received:
            actualAmount,
        });
        return;
      }

      /**
       * Confirm cancellation state.
       */
      const piStatus =
        paymentData.status;

      if (
        piStatus?.cancelled ||
        piStatus?.user_cancelled
      ) {
        await db
          .update(paymentsTable)
          .set({
            status:
              "cancelled",
            providerPaymentId:
              sdkPaymentId,
            providerReference:
              cleanTxid,
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

      /**
       * The transaction must be verified
       * before we can complete the payment.
       */
      if (
        !piStatus?.developer_approved
      ) {
        res.status(409).json({
          error:
            "Pi payment has not been approved by the developer",
        });
        return;
      }

      if (
        !piStatus?.transaction_verified
      ) {
        res.status(409).json({
          error:
            "Pi transaction has not been verified",
        });
        return;
      }

      /**
       * Confirm transaction ID.
       */
      const transactionTxid =
        paymentData
          .transaction?.txid;

      if (
        transactionTxid &&
        transactionTxid !==
          cleanTxid
      ) {
        logger.warn(
          {
            piPaymentId:
              sdkPaymentId,
            expectedTxid:
              transactionTxid,
            receivedTxid:
              cleanTxid,
          },
          "Pi transaction ID mismatch",
        );

        res.status(409).json({
          error:
            "Transaction ID does not match Pi payment",
        });
        return;
      }

      /**
       * Step 2:
       * Complete the payment on Pi.
       *
       * IMPORTANT:
       * We do not mark our order as paid
       * until this API call succeeds.
       */
      const completeResponse =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            sdkPaymentId,
          )}/complete`,
          {
            method: "POST",
            headers:
              getPiHeaders(),
            body:
              JSON.stringify({
                txid:
                  cleanTxid,
              }),
          },
        );

      const completeText =
        await completeResponse.text();

      let completeData:
        | Record<
            string,
            unknown
          >
        | null = null;

      try {
        completeData =
          completeText
            ? (JSON.parse(
                completeText,
              ) as Record<
                string,
                unknown
              >)
            : null;
      } catch {
        completeData = null;
      }

      if (!completeResponse.ok) {
        logger.warn(
          {
            status:
              completeResponse.status,
            piPaymentId:
              sdkPaymentId,
            completeData,
            response:
              completeText,
          },
          "Pi payment completion failed",
        );

        res.status(502).json({
          error:
            "Pi payment completion failed",
        });
        return;
      }

      /**
       * Step 3:
       * Now and only now mark the
       * internal payment and order as paid.
       */
      const paidAt =
        new Date();

      await db
        .update(paymentsTable)
        .set({
          status: "paid",
          providerPaymentId:
            sdkPaymentId,
          providerReference:
            cleanTxid,
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
          piPaymentId:
            sdkPaymentId,
          piTxid:
            cleanTxid,
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
          piPaymentId:
            sdkPaymentId,
          txid:
            cleanTxid,
          orderId:
            order.id,
        },
        "Pi payment completed successfully",
      );

      res.json({
        success: true,
        status: "paid",
        paymentId:
          payment.id,
        piPaymentId:
          sdkPaymentId,
        txid:
          cleanTxid,
        orderId:
          order.id,
        message:
          "Pi payment verified and completed",
      });
    } catch (err) {
      logger.error(
        {
          err,
          paymentId:
            payment.id,
          piPaymentId:
            sdkPaymentId,
          orderId:
            order.id,
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

/**
 * POST /payments/pi/cancel
 *
 * Called by:
 *
 * onCancel(paymentId)
 *
 * The paymentId from Pi SDK is the Pi payment ID.
 */
router.post(
  "/payments/pi/cancel",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      piPaymentId,
      orderId,
    } = req.body as {
      paymentId?: unknown;
      piPaymentId?: unknown;
      orderId?: unknown;
    };

    const cleanPiPaymentId =
      typeof paymentId ===
        "string"
        ? paymentId.trim()
        : typeof piPaymentId ===
              "string"
          ? piPaymentId.trim()
          : "";

    if (!cleanPiPaymentId) {
      res.status(400).json({
        error:
          "paymentId is required",
      });
      return;
    }

    let payment:
      | typeof paymentsTable.$inferSelect
      | undefined;

    const [byProviderId] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(
              paymentsTable.providerPaymentId,
              cleanPiPaymentId,
            ),
            eq(
              paymentsTable.userId,
              req.user!.id,
            ),
          ),
        );

    payment =
      byProviderId;

    /*
     * Backward compatibility with
     * numeric internal payment IDs.
     */
    if (!payment) {
      const numericId =
        Number(cleanPiPaymentId);

      if (
        Number.isInteger(
          numericId,
        ) &&
        numericId > 0
      ) {
        const [byLocalId] =
          await db
            .select()
            .from(paymentsTable)
            .where(
              and(
                eq(
                  paymentsTable.id,
                  numericId,
                ),
                eq(
                  paymentsTable.userId,
                  req.user!.id,
                ),
              ),
            );

        payment =
          byLocalId;
      }
    }

    if (!payment) {
      res.status(404).json({
        error:
          "Payment not found",
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
      orderId != null &&
      (!Number.isInteger(
        orderId,
      ) ||
        payment.orderId !==
          orderId)
    ) {
      res.status(400).json({
        error:
          "Payment does not belong to this order",
      });
      return;
    }

    try {
      const response =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            cleanPiPaymentId,
          )}/cancel`,
          {
            method: "POST",
            headers: getPiHeaders(),
          },
        );

      const text =
        await response.text();

      let data: unknown = null;

      try {
        data = text
          ? JSON.parse(text)
          : null;
      } catch {
        data = text;
      }

      /*
       * If Pi says the payment is already
       * cancelled, we can still synchronize
       * our local state.
       */
      if (!response.ok) {
        logger.warn(
          {
            status:
              response.status,
            piPaymentId:
              cleanPiPaymentId,
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
            cleanPiPaymentId,
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
        piPaymentId:
          cleanPiPaymentId,
        data,
      });
    } catch (err) {
      logger.error(
        {
          err,
          piPaymentId:
            cleanPiPaymentId,
        },
        "Pi payment cancellation failed",
      );

      res.status(502).json({
        error:
          "Unable to cancel Pi payment",
      });
    }
  },
);

/**
 * GET /payments/:id
 *
 * Returns an internal payment record.
 */
router.get(
  "/payments/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = parseInt(
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
  },
);

export default router;