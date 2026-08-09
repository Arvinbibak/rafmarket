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

/* =========================================================
   POST /payments
   Create a payment record for Pi or Iranian Rial
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

    const paymentMethod = method as PaymentMethod;

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.id, parsedOrderId),
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
      paymentMethod === "pi"
        ? "Pi"
        : "IRR";

    const provider =
      paymentMethod === "pi"
        ? "pi"
        : "zarinpal";

    /*
     * Do not allow a payment currency to differ from
     * the currency stored on the order.
     */
    if (order.currency !== currency) {
      res.status(409).json({
        error:
          "Payment currency does not match order currency",
        orderCurrency: order.currency,
        requestedCurrency: currency,
      });
      return;
    }

    const [existingPayment] = await db
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

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        orderId: parsedOrderId,
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
        error: "Unable to create payment",
      });
      return;
    }

    res.status(201).json({
      success: true,
      payment,
      amount: Number(order.total),
      currency,
      method: paymentMethod,
    });
  },
);

/* =========================================================
   POST /payments/irr/initiate
   Create Iranian Rial payment and return gateway URL
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

    const parsedOrderId = parseId(orderId);

    if (!parsedOrderId) {
      res.status(400).json({
        error: "Valid orderId is required",
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
            parsedOrderId,
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

    const [existingPayment] = await db
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
            "irr",
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
          orderId: parsedOrderId,
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

    /*
     * If a gateway URL already exists, reuse it.
     */
    if (
      payment.gatewayUrl &&
      payment.providerReference
    ) {
      res.json({
        success: true,
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

    const result = await createIrrPayment(
      amount,
      `RafMarket order #${order.id}`,
      {
        orderId: order.id,
      },
    );

    if (!result.success || !result.authority) {
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
      );

    req.log.info(
      {
        paymentId: payment.id,
        orderId: order.id,
        authority: result.authority,
        amount,
      },
      "Iranian payment initiated",
    );

    res.json({
      success: true,
      status: "processing",
      paymentId: payment.id,
      orderId: order.id,
      amount,
      currency: "IRR",
      authority: result.authority,
      paymentUrl,
      message:
        "Iranian payment created successfully",
    });
  },
);

/* =========================================================
   GET /payments/irr/callback
   ZarinPal redirects customer here after payment
   ========================================================= */

router.get(
  "/payments/irr/callback",
  async (req, res): Promise<void> => {
    const authority =
      typeof req.query.Authority === "string"
        ? req.query.Authority
        : "";

    const status =
      typeof req.query.Status === "string"
        ? req.query.Status
        : "";

    if (!authority) {
      res.status(400).json({
        error: "Payment authority is missing",
      });
      return;
    }

    const [payment] = await db
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
        error: "Invalid payment method",
      });
      return;
    }

    /*
     * User cancelled or gateway reported failure.
     */
    if (status.toLowerCase() !== "ok") {
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

    const amount = Number(payment.amount);

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
      const verifyResponse = await fetch(
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
            verifyData,
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

      /*
       * ZarinPal:
       * 100 = successful verification
       * 101 = already verified
       */
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
          gatewayCode: code ?? null,
          message:
            verifyData.data?.message ||
            "Iranian payment could not be verified",
        });
        return;
      }

      const refId =
        verifyData.data?.ref_id;

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
        );

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
          ),
        );

      logger.info(
        {
          paymentId: payment.id,
          orderId: payment.orderId,
          authority,
          refId,
        },
        "Iranian payment verified successfully",
      );

      res.json({
        success: true,
        status: "paid",
        paymentId: payment.id,
        orderId: payment.orderId,
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
          paymentId: payment.id,
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

    const parsedOrderId = parseId(orderId);
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

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(
            ordersTable.id,
            parsedOrderId,
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

    if (order.currency !== "Pi") {
      res.status(409).json({
        error:
          "This order is not a Pi order",
      });
      return;
    }

    const orderAmount =
      Number(order.total);

    if (
      !Number.isFinite(orderAmount) ||
      parsedAmount !== orderAmount
    ) {
      res.status(400).json({
        error:
          "Payment amount does not match order total",
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

    let payment;

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
          orderId:
            parsedOrderId,
          userId:
            req.user!.id,
          method: "pi",
          status: "pending",
          amount: order.total,
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
        orderId:
          parsedOrderId,
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
        parsedOrderId,
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
      typeof piPaymentId !== "string" ||
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
              parsedPaymentId,
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

    try {
      const response =
        await fetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            piPaymentId,
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
          status:
            "processing",
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
          "approved",
        paymentId:
          payment.id,
        piPaymentId,
        data,
      });
    } catch (error) {
      logger.error(
        {
          error,
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

/* =========================================================
   POST /payments/pi/complete
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
      typeof txid !== "string" ||
      !txid.trim()
    ) {
      res.status(400).json({
        error:
          "paymentId, piPaymentId and txid are required",
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
              parsedPaymentId,
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
        error: "Order not found",
      });
      return;
    }

    if (order.currency !== "Pi") {
      res.status(409).json({
        error:
          "Order currency is not Pi",
      });
      return;
    }

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

      const expectedAmount =
        Number(order.total);

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

      const status =
        paymentData.status;

      if (
        status?.cancelled ||
        status?.user_cancelled
      ) {
        await db
          .update(
            paymentsTable,
          )
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
        !status?.developer_approved ||
        !status?.transaction_verified
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
            body:
              JSON.stringify({
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

      const paidAt =
        new Date();

      await db
        .update(
          paymentsTable,
        )
        .set({
          status: "paid",
          provider:
            "pi",
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
        .update(
          ordersTable,
        )
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
    } catch (error) {
      logger.error(
        {
          error,
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

    const [payment] =
      await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(
              paymentsTable.id,
              parsedPaymentId,
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
        .update(
          paymentsTable,
        )
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
    } catch (error) {
      logger.error(
        {
          error,
          piPaymentId,
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
      parseId(
        Array.isArray(
          req.params.id,
        )
          ? req.params.id[0]
          : req.params.id,
      );

    if (!id) {
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