import { Router, type IRouter } from "express";
import {
  db,
  ordersTable,
  paymentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { createIrrPayment } from "../lib/gateway";

const router: IRouter = Router();

type PaymentMethod = "pi" | "irr";

const PI_API_BASE = "https://api.minepi.com/v2";

const ZARINPAL_VERIFY_URL =
  "https://payment.zarinpal.com/pg/v4/payment/verify.json";

const ZARINPAL_START_URL =
  "https://www.zarinpal.com/pg/StartPay";

const IRR_MERCHANT_ID =
  process.env.IRR_MERCHANT_ID || "";

function parseId(value: unknown): number | null {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

function parsePositiveAmount(value: unknown): number | null {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount;
}

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

async function getUserOrder(
  orderId: number,
  userId: number,
) {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.userId, userId),
      ),
    );

  return order;
}

async function getPayment(
  paymentId: number,
  userId: number,
) {
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.id, paymentId),
        eq(paymentsTable.userId, userId),
      ),
    );

  return payment;
}

/* =========================================================
   POST /payments

   Creates a payment record.
   Supported methods:
   - pi
   - irr
   ========================================================= */

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

    const parsedOrderId = parseId(orderId);

    if (
      !parsedOrderId ||
      typeof method !== "string" ||
      !["pi", "irr"].includes(method)
    ) {
      res.status(400).json({
        error: "orderId and valid payment method are required",
        allowedMethods: ["pi", "irr"],
      });
      return;
    }

    const paymentMethod =
      method as PaymentMethod;

    const order = await getUserOrder(
      parsedOrderId,
      req.user!.id,
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

    const expectedCurrency =
      paymentMethod === "pi"
        ? "Pi"
        : "IRR";

    if (order.currency !== expectedCurrency) {
      res.status(409).json({
        error:
          "Payment currency does not match order currency",
        orderCurrency: order.currency,
        requestedCurrency: expectedCurrency,
      });
      return;
    }

    const provider =
      paymentMethod === "pi"
        ? "pi"
        : "zarinpal";

    const [existingPayment] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(
              paymentsTable.orderId,
              parsedOrderId,
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
          orderId: parsedOrderId,
          userId: req.user!.id,
          method: paymentMethod,
          status: "pending",
          amount: order.total,
          currency: expectedCurrency,
          provider,
        })
        .returning();

    if (!payment) {
      res.status(500).json({
        error: "Unable to create payment",
      });
      return;
    }

    res.status(201).json({
      success: true,
      payment,
      amount: Number(order.total),
      currency: expectedCurrency,
      method: paymentMethod,
    });
  },
);

/* =========================================================
   POST /payments/irr/initiate

   Creates a ZarinPal payment and returns gateway URL.
   ========================================================= */

router.post(
  "/payments/irr/initiate",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      orderId,
    } = req.body as {
      orderId?: unknown;
    };

    const parsedOrderId =
      parseId(orderId);

    if (!parsedOrderId) {
      res.status(400).json({
        error: "Valid orderId is required",
      });
      return;
    }

    const order = await getUserOrder(
      parsedOrderId,
      req.user!.id,
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

    if (order.currency !== "IRR") {
      res.status(409).json({
        error:
          "This order is not an Iranian Rial order",
        orderCurrency: order.currency,
      });
      return;
    }

    const amount = Number(order.total);

    if (
      !Number.isFinite(amount) ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      res.status(409).json({
        error:
          "Invalid Iranian Rial order amount",
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
              order.id,
            ),
            eq(
              paymentsTable.userId,
              req.user!.id,
            ),
            eq(
              paymentsTable.method,
              "irr",
            ),
          ),
        );

    if (existingPayment) {
      payment = existingPayment;
    } else {
      [payment] =
        await db
          .insert(paymentsTable)
          .values({
            orderId: order.id,
            userId: req.user!.id,
            method: "irr",
            status: "pending",
            amount: order.total,
            currency: "IRR",
            provider: "zarinpal",
          })
          .returning();
    }

    if (!payment) {
      res.status(500).json({
        error: "Unable to create payment",
      });
      return;
    }

    if (
      payment.status === "paid"
    ) {
      res.status(409).json({
        error:
          "Payment has already been completed",
      });
      return;
    }

    if (
      payment.gatewayUrl &&
      payment.providerReference
    ) {
      res.json({
        success: true,
        status: payment.status,
        paymentId: payment.id,
        orderId: order.id,
        amount,
        currency: "IRR",
        authority:
          payment.providerReference,
        paymentUrl:
          payment.gatewayUrl,
      });
      return;
    }

    const result =
      await createIrrPayment(
        amount,
        `RafMarket order #${order.id}`,
        {
          orderId: order.id,
        },
      );

    if (
      !result.success ||
      !result.authority
    ) {
      res.status(502).json({
        error:
          result.message ||
          "Unable to create Iranian payment",
      });
      return;
    }

    const paymentUrl =
      result.paymentUrl ||
      `${ZARINPAL_START_URL}/${result.authority}`;

    const [updatedPayment] =
      await db
        .update(paymentsTable)
        .set({
          provider: "zarinpal",
          providerReference:
            result.authority,
          gatewayUrl: paymentUrl,
          status: "processing",
        })
        .where(
          eq(
            paymentsTable.id,
            payment.id,
          ),
        )
        .returning();

    req.log.info(
      {
        paymentId: payment.id,
        orderId: order.id,
        amount,
      },
      "Iranian payment initiated",
    );

    res.json({
      success: true,
      status: "processing",
      paymentId:
        updatedPayment?.id ??
        payment.id,
      orderId: order.id,
      amount,
      currency: "IRR",
      authority:
        result.authority,
      paymentUrl,
    });
  },
);

/* =========================================================
   GET /payments/irr/callback

   ZarinPal callback.

   IMPORTANT:
   Payment is considered successful ONLY after
   server-side verification with ZarinPal.
   ========================================================= */

router.get(
  "/payments/irr/callback",
  async (req, res): Promise<void> => {
    const authority =
      typeof req.query.Authority ===
      "string"
        ? req.query.Authority
        : "";

    const status =
      typeof req.query.Status ===
      "string"
        ? req.query.Status
        : "";

    if (!authority) {
      res.status(400).json({
        error:
          "Payment authority is missing",
      });
      return;
    }

    const [payment] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          eq(
            paymentsTable.providerReference,
            authority,
          ),
        );

    if (!payment) {
      res.status(404).json({
        error: "Payment not found",
      });
      return;
    }

    if (payment.method !== "irr") {
      res.status(400).json({
        error:
          "Invalid payment method",
      });
      return;
    }

    if (payment.status === "paid") {
      res.json({
        success: true,
        status: "paid",
        paymentId: payment.id,
        orderId: payment.orderId,
        message:
          "Payment was already verified",
      });
      return;
    }

    if (
      status.toLowerCase() !== "ok"
    ) {
      await db
        .update(paymentsTable)
        .set({
          status: "cancelled",
        })
        .where(
          eq(
            paymentsTable.id,
            payment.id,
          ),
        );

      res.json({
        success: false,
        status: "cancelled",
        paymentId: payment.id,
        orderId: payment.orderId,
        message:
          "Iranian payment was cancelled",
      });
      return;
    }

    if (!IRR_MERCHANT_ID) {
      logger.error(
        "IRR_MERCHANT_ID is not configured",
      );

      res.status(500).json({
        error:
          "Iranian payment gateway is not configured",
      });
      return;
    }

    const amount =
      Number(payment.amount);

    if (
      !Number.isFinite(amount) ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      res.status(500).json({
        error:
          "Invalid payment amount",
      });
      return;
    }

    try {
      const verifyResponse =
        await fetch(
          ZARINPAL_VERIFY_URL,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },
            body: JSON.stringify({
              merchant_id:
                IRR_MERCHANT_ID,
              amount,
              authority,
            }),
          },
        );

      const verifyData =
        (await verifyResponse.json()) as {
          data?: {
            code?: number;
            message?: string;
            ref_id?: number;
            card_pan?: string;
          };
          errors?: unknown;
        };

      if (!verifyResponse.ok) {
        logger.error(
          {
            status:
              verifyResponse.status,
            paymentId: payment.id,
          },
          "ZarinPal verification request failed",
        );

        res.status(502).json({
          error:
            "Iranian payment verification failed",
        });
        return;
      }

      const code =
        verifyData.data?.code;

      if (
        code !== 100 &&
        code !== 101
      ) {
        await db
          .update(paymentsTable)
          .set({
            status: "failed",
          })
          .where(
            eq(
              paymentsTable.id,
              payment.id,
            ),
          );

        res.status(409).json({
          success: false,
          status: "failed",
          paymentId: payment.id,
          orderId: payment.orderId,
          gatewayCode:
            code ?? null,
          message:
            verifyData.data?.message ||
            "Iranian payment could not be verified",
        });
        return;
      }

      const refId =
        verifyData.data?.ref_id;

      const [updatedPayment] =
        await db
          .update(paymentsTable)
          .set({
            status: "paid",
            provider: "zarinpal",
            providerReference:
              authority,
            paidAt: new Date(),
          })
          .where(
            eq(
              paymentsTable.id,
              payment.id,
            ),
          )
          .returning();

      if (
        !updatedPayment
      ) {
        res.status(500).json({
          error:
            "Unable to update payment",
        });
        return;
      }

      await db
        .update(ordersTable)
        .set({
          status: "paid",
        })
        .where(
          and(
            eq(
              ordersTable.id,
              payment.orderId,
            ),
            eq(
              ordersTable.userId,
              payment.userId,
            ),
            eq(
              ordersTable.status,
              "pending",
            ),
          ),
        );

      logger.info(
        {
          paymentId:
            payment.id,
          orderId:
            payment.orderId,
          authority,
          refId,
        },
        "Iranian payment verified successfully",
      );

      res.json({
        success: true,
        status: "paid",
        paymentId:
          payment.id,
        orderId:
          payment.orderId,
        authority,
        refId:
          refId ?? null,
        message:
          "Iranian payment verified successfully",
      });
    } catch (error) {
      logger.error(
        {
          error,
          paymentId:
            payment.id,
          authority,
        },
        "Iranian payment verification failed",
      );

      res.status(502).json({
        error:
          "Unable to verify Iranian payment",
      });
    }
  },
);

/* =========================================================
   POST /payments/pi/initiate
   ========================================================= */

router.post(
  "/payments/pi/initiate",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      orderId,
      amount,
    } = req.body as {
      orderId?: unknown;
      amount?: unknown;
    };

    const parsedOrderId =
      parseId(orderId);

    const parsedAmount =
      parsePositiveAmount(amount);

    if (
      !parsedOrderId ||
      parsedAmount === null
    ) {
      res.status(400).json({
        error:
          "Valid orderId and amount are required",
      });
      return;
    }

    const order =
      await getUserOrder(
        parsedOrderId,
        req.user!.id,
      );

    if (!order) {
      res.status(404).json({
        error: "Order not found",
      });
      return;
    }

    if (order.currency !== "Pi") {
      res.status(409).json({
        error:
          "This order is not a Pi order",
        orderCurrency:
          order.currency,
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
      !Number.isFinite(
        orderAmount,
      ) ||
      parsedAmount !==
        orderAmount
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
      payment =
        existingPayment;
    } else {
      [payment] =
        await db
          .insert(paymentsTable)
          .values({
            orderId: order.id,
            userId:
              req.user!.id,
            method: "pi",
            status: "pending",
            amount:
              order.total,
            currency: "Pi",
            provider: "pi",
          })
          .returning();
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
        orderId: order.id,
        paymentId:
          payment.id,
        amount:
          orderAmount,
      },
      "Pi payment initiated",
    );

    res.json({
      success: true,
      status: "initiated",
      paymentId:
        payment.id,
      piPaymentId:
        payment.providerPaymentId,
      txid: null,
      orderId:
        order.id,
      amount:
        orderAmount,
      currency: "Pi",
      message:
        "Pi payment initiated",
    });
  },
);

/* =========================================================
   POST /payments/pi/approve
   ========================================================= */

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

    const parsedPaymentId =
      parseId(paymentId);

    const parsedOrderId =
      orderId == null
        ? null
        : parseId(orderId);

    if (
      !parsedPaymentId ||
      (
        orderId != null &&
        !parsedOrderId
      ) ||
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

    const payment =
      await getPayment(
        parsedPaymentId,
        req.user!.id,
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
      parsedOrderId &&
      payment.orderId !==
        parsedOrderId
    ) {
      res.status(400).json({
        error:
          "Payment does not belong to this order",
      });
      return;
    }

    const order =
      await getUserOrder(
        payment.orderId,
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

    const paymentAmount =
      Number(payment.amount);

    if (
      !Number.isFinite(
        paymentAmount,
      ) ||
      paymentAmount !==
        Number(order.total)
    ) {
      res.status(409).json({
        error:
          "Payment amount does not match order",
      });
      return;
    }

    try {
      const response =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            piPaymentId.trim(),
          )}/approve`,
          {
            method: "POST",
            headers:
              getPiHeaders(),
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
            paymentId:
              payment.id,
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
            piPaymentId.trim(),
          status:
            "processing",
        })
        .where(
          and(
            eq(
              paymentsTable.id,
              payment.id,
            ),
            eq(
              paymentsTable.status,
              "pending",
            ),
          ),
        );

      res.json({
        success: true,
        status:
          "approved",
        paymentId:
          payment.id,
        piPaymentId:
          piPaymentId.trim(),
        data,
      });
    } catch (error) {
      logger.error(
        {
          error,
          paymentId:
            payment.id,
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

/* =========================================================
   POST /payments/pi/complete

   IMPORTANT:
   The client-provided txid is NOT trusted.
   The server verifies the payment with Pi API
   before marking the order as paid.
   ========================================================= */

router.post(
  "/payments/pi/complete",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      piPaymentId,
      txid,
    } = req.body as {
      paymentId?: unknown;
      piPaymentId?: unknown;
      txid?: unknown;
    };

    const parsedPaymentId =
      parseId(paymentId);

    if (
      !parsedPaymentId ||
      typeof piPaymentId !==
        "string" ||
      !piPaymentId.trim() ||
      typeof txid !==
        "string" ||
      !txid.trim()
    ) {
      res.status(400).json({
        error:
          "paymentId, piPaymentId and txid are required",
      });
      return;
    }

    const payment =
      await getPayment(
        parsedPaymentId,
        req.user!.id,
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
      payment.status ===
      "paid"
    ) {
      res.json({
        success: true,
        status: "paid",
        paymentId:
          payment.id,
        orderId:
          payment.orderId,
        message:
          "Payment already completed",
      });
      return;
    }

    const order =
      await getUserOrder(
        payment.orderId,
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

    const expectedAmount =
      Number(order.total);

    if (
      !Number.isFinite(
        expectedAmount,
      ) ||
      expectedAmount <= 0
    ) {
      res.status(409).json({
        error:
          "Invalid order amount",
      });
      return;
    }

    try {
      const verifyResponse =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            piPaymentId.trim(),
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
          };
        };

      if (!verifyResponse.ok) {
        logger.warn(
          {
            status:
              verifyResponse.status,
            paymentId:
              payment.id,
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
        Number(
          paymentData.amount,
        );

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
          actualAmount,
        });
        return;
      }

      const piTransactionTxid =
        paymentData.transaction
          ?.txid;

      if (
        piTransactionTxid &&
        piTransactionTxid !==
          txid.trim()
      ) {
        res.status(409).json({
          error:
            "Transaction ID does not match Pi payment",
        });
        return;
      }

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
              piPaymentId.trim(),
            providerReference:
              txid.trim(),
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
        !piStatus?.developer_approved ||
        !piStatus?.transaction_verified
      ) {
        res.status(409).json({
          error:
            "Pi payment has not been verified",
        });
        return;
      }

      /*
       * Tell Pi that the payment is complete.
       */

      const completeResponse =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            piPaymentId.trim(),
          )}/complete`,
          {
            method: "POST",
            headers:
              getPiHeaders(),
            body:
              JSON.stringify({
                txid:
                  txid.trim(),
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
            paymentId:
              payment.id,
          },
          "Pi payment completion failed",
        );

        res.status(502).json({
          error:
            "Pi payment completion failed",
        });
        return;
      }

      /*
       * Only after successful Pi completion
       * do we mark our own payment and order
       * as paid.
       */

      const paidAt =
        new Date();

      const [updatedPayment] =
        await db
          .update(paymentsTable)
          .set({
            status: "paid",
            provider: "pi",
            providerPaymentId:
              piPaymentId.trim(),
            providerReference:
              txid.trim(),
            paidAt,
          })
          .where(
            and(
              eq(
                paymentsTable.id,
                payment.id,
              ),
              eq(
                paymentsTable.status,
                "processing",
              ),
            ),
          )
          .returning();

      /*
       * If another request completed the payment
       * concurrently, return the already-paid state.
       */

      if (!updatedPayment) {
        const [currentPayment] =
          await db
            .select()
            .from(
              paymentsTable,
            )
            .where(
              eq(
                paymentsTable.id,
                payment.id,
              ),
            );

        if (
          currentPayment?.status ===
          "paid"
        ) {
          res.json({
            success: true,
            status: "paid",
            paymentId:
              payment.id,
            orderId:
              order.id,
            message:
              "Payment already completed",
          });
          return;
        }

        res.status(409).json({
          error:
            "Payment state changed before completion",
        });
        return;
      }

      await db
        .update(ordersTable)
        .set({
          status: "paid",
          piPaymentId:
            piPaymentId.trim(),
          piTxid:
            txid.trim(),
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
            eq(
              ordersTable.status,
              "pending",
            ),
          ),
        );

      req.log.info(
        {
          paymentId:
            payment.id,
          piPaymentId:
            piPaymentId.trim(),
          txid:
            txid.trim(),
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
        piPaymentId:
          piPaymentId.trim(),
        txid:
          txid.trim(),
        orderId:
          order.id,
        data:
          completeData,
        message:
          "Pi payment verified and completed",
      });
    } catch (error) {
      logger.error(
        {
          error,
          paymentId:
            payment.id,
          piPaymentId:
            piPaymentId.trim(),
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

/* =========================================================
   POST /payments/pi/cancel
   ========================================================= */

router.post(
  "/payments/pi/cancel",
  requireAuth,
  async (req, res): Promise<void> => {
    const {
      paymentId,
      piPaymentId,
    } = req.body as {
      paymentId?: unknown;
      piPaymentId?: unknown;
    };

    const parsedPaymentId =
      parseId(paymentId);

    if (
      !parsedPaymentId ||
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

    const payment =
      await getPayment(
        parsedPaymentId,
        req.user!.id,
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
      payment.status ===
      "paid"
    ) {
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
            piPaymentId.trim(),
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
            paymentId:
              payment.id,
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
          provider:
            "pi",
          providerPaymentId:
            piPaymentId.trim(),
        })
        .where(
          and(
            eq(
              paymentsTable.id,
              payment.id,
            ),
            eq(
              paymentsTable.status,
              "pending",
            ),
          ),
        );

      res.json({
        success: true,
        status:
          "cancelled",
        paymentId:
          payment.id,
        piPaymentId:
          piPaymentId.trim(),
      });
    } catch (error) {
      logger.error(
        {
          error,
          paymentId:
            payment.id,
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

/* =========================================================
   GET /payments/:id
   ========================================================= */

router.get(
  "/payments/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const id =
      parseId(req.params.id);

    if (!id) {
      res.status(400).json({
        error:
          "Invalid payment id",
      });
      return;
    }

    const payment =
      await getPayment(
        id,
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

export default router;