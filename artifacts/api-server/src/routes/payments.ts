import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";

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

type PiPaymentStatus = {
  developer_approved?: boolean;
  transaction_verified?: boolean;
  developer_completed?: boolean;
  cancelled?: boolean;
  user_cancelled?: boolean;
};

type PiTransaction = {
  txid?: string;
  verified?: boolean;
};

type PiPaymentResponse = {
  identifier?: string;
  amount?: number;
  memo?: string;
  metadata?: unknown;
  status?: PiPaymentStatus;
  transaction?: PiTransaction;
};

type PiFetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

type PaymentRecord = typeof paymentsTable.$inferSelect;

async function piFetch(
  input: string,
  init?: RequestInit,
): Promise<PiFetchResponse> {
  return (await globalThis.fetch(
    input,
    init,
  )) as unknown as PiFetchResponse;
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

function parsePositiveInteger(
  value: unknown,
): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function parsePositiveNumber(
  value: unknown,
): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : null;
}

async function findUserPayment(
  paymentId: string,
  userId: number,
): Promise<PaymentRecord | undefined> {
  const [byProviderId] = await db
    .select()
    .from(paymentsTable)
    .where(
      and(
        eq(
          paymentsTable.providerPaymentId,
          paymentId,
        ),
        eq(
          paymentsTable.userId,
          userId,
        ),
      ),
    );

  if (byProviderId) {
    return byProviderId;
  }

  const numericId = Number(paymentId);

  if (
    Number.isInteger(numericId) &&
    numericId > 0
  ) {
    const [byLocalId] = await db
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
            userId,
          ),
        ),
      );

    if (byLocalId) {
      return byLocalId;
    }
  }

  return undefined;
}

function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* -------------------------------------------------------------------------- */
/* POST /payments                                                             */
/* -------------------------------------------------------------------------- */

router.post(
  "/payments",
  requireAuth,
  async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const {
      orderId,
      method,
      amount,
      currency,
      providerPaymentId,
      providerReference,
    } = req.body as {
      orderId?: unknown;
      method?: unknown;
      amount?: unknown;
      currency?: unknown;
      providerPaymentId?: unknown;
      providerReference?: unknown;
    };

    const parsedOrderId =
      parsePositiveInteger(orderId);

    if (!parsedOrderId) {
      res.status(400).json({
        error: "Valid orderId is required",
      });
      return;
    }

    if (
      method !== "pi" &&
      method !== "irr"
    ) {
      res.status(400).json({
        error:
          "Payment method must be pi or irr",
      });
      return;
    }

    const parsedAmount =
      parsePositiveNumber(amount);

    if (!parsedAmount) {
      res.status(400).json({
        error: "Valid amount is required",
      });
      return;
    }

    if (
      typeof currency !== "string" ||
      !currency.trim()
    ) {
      res.status(400).json({
        error: "Currency is required",
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

    if (order.status === "cancelled") {
      res.status(409).json({
        error: "Order is cancelled",
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
              parsedOrderId,
            ),
            eq(
              paymentsTable.userId,
              req.user!.id,
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
          method: method as PaymentMethod,
          amount: String(parsedAmount),
          currency: currency.trim(),
          status: "pending",
          providerPaymentId:
            typeof providerPaymentId === "string"
              ? providerPaymentId.trim()
              : null,
          providerReference:
            typeof providerReference === "string"
              ? providerReference.trim()
              : null,
        })
        .returning();

    res.status(201).json({
      success: true,
      payment,
    });
  },
);

/* -------------------------------------------------------------------------- */
/* POST /payments/pi/initiate                                                 */
/* -------------------------------------------------------------------------- */

router.post(
  "/payments/pi/initiate",
  requireAuth,
  async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const {
      orderId,
      paymentId,
      piPaymentId,
      amount,
      memo,
      metadata,
    } = req.body as {
      orderId?: unknown;
      paymentId?: unknown;
      piPaymentId?: unknown;
      amount?: unknown;
      memo?: unknown;
      metadata?: unknown;
    };

    const parsedOrderId =
      parsePositiveInteger(orderId);

    if (!parsedOrderId) {
      res.status(400).json({
        error: "Valid orderId is required",
      });
      return;
    }

    const cleanPiPaymentId =
      typeof piPaymentId === "string"
        ? piPaymentId.trim()
        : typeof paymentId === "string"
          ? paymentId.trim()
          : "";

    if (!cleanPiPaymentId) {
      res.status(400).json({
        error: "Pi paymentId is required",
      });
      return;
    }

    const parsedAmount =
      parsePositiveNumber(amount);

    if (!parsedAmount) {
      res.status(400).json({
        error: "Valid amount is required",
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

    if (order.status === "cancelled") {
      res.status(409).json({
        error: "Order is cancelled",
      });
      return;
    }

    const existingPayment =
      await findUserPayment(
        cleanPiPaymentId,
        req.user!.id,
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
          method: "pi",
          amount: String(parsedAmount),
          currency: "Pi",
          status: "pending",
          providerPaymentId:
            cleanPiPaymentId,
          providerReference:
            typeof memo === "string"
              ? memo.trim()
              : null,
          metadata: metadata ?? null,
        })
        .returning();

    logger.info(
      {
        paymentId: payment.id,
        piPaymentId: cleanPiPaymentId,
        orderId: order.id,
      },
      "Pi payment initiated",
    );

    res.status(201).json({
      success: true,
      payment,
    });
  },
);

/* -------------------------------------------------------------------------- */
/* POST /payments/pi/approve                                                  */
/* -------------------------------------------------------------------------- */

router.post(
  "/payments/pi/approve",
  requireAuth,
  async (
    req: Request,
    res: Response,
  ): Promise<void> => {
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
      typeof paymentId === "string"
        ? paymentId.trim()
        : typeof piPaymentId === "string"
          ? piPaymentId.trim()
          : "";

    if (!cleanPiPaymentId) {
      res.status(400).json({
        error: "paymentId is required",
      });
      return;
    }

    const payment =
      await findUserPayment(
        cleanPiPaymentId,
        req.user!.id,
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
      orderId != null &&
      Number(orderId) !== payment.orderId
    ) {
      res.status(400).json({
        error:
          "Payment does not belong to this order",
      });
      return;
    }

    try {
      const response = await piFetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(
          cleanPiPaymentId,
        )}/approve`,
        {
          method: "POST",
          headers: getPiHeaders(),
        },
      );

      const text = await response.text();
      const data = parseJson(text);

      if (!response.ok) {
        logger.warn(
          {
            status: response.status,
            piPaymentId: cleanPiPaymentId,
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
          status: "approved",
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
        status: "approved",
        paymentId: payment.id,
        piPaymentId:
          cleanPiPaymentId,
        data,
      });
    } catch (err) {
      logger.error(
        {
          err,
          piPaymentId: cleanPiPaymentId,
        },
        "Pi payment approval failed",
      );

      res.status(502).json({
        error:
          "Unable to approve Pi payment",
      });
    }
  },
);

/* -------------------------------------------------------------------------- */
/* POST /payments/pi/complete                                                 */
/* -------------------------------------------------------------------------- */

router.post(
  "/payments/pi/complete",
  requireAuth,
  async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const {
      paymentId,
      piPaymentId,
      orderId,
      txid,
    } = req.body as {
      paymentId?: unknown;
      piPaymentId?: unknown;
      orderId?: unknown;
      txid?: unknown;
    };

    const sdkPaymentId =
      typeof paymentId === "string"
        ? paymentId.trim()
        : typeof piPaymentId === "string"
          ? piPaymentId.trim()
          : "";

    const cleanTxid =
      typeof txid === "string"
        ? txid.trim()
        : "";

    if (!sdkPaymentId) {
      res.status(400).json({
        error: "paymentId is required",
      });
      return;
    }

    if (!cleanTxid) {
      res.status(400).json({
        error: "txid is required",
      });
      return;
    }

    const payment =
      await findUserPayment(
        sdkPaymentId,
        req.user!.id,
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

    if (
      orderId != null &&
      Number(orderId) !== order.id
    ) {
      res.status(400).json({
        error:
          "Payment does not belong to this order",
      });
      return;
    }

    try {
      const verifyResponse =
        await piFetch(
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
        | PiPaymentResponse
        | null = null;

      const parsedVerify =
        parseJson(verifyText);

      if (
        parsedVerify &&
        typeof parsedVerify === "object"
      ) {
        paymentData =
          parsedVerify as PiPaymentResponse;
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

      const piStatus =
        paymentData?.status;

      if (
        piStatus?.cancelled ||
        piStatus?.user_cancelled
      ) {
        await db
          .update(paymentsTable)
          .set({
            status: "cancelled",
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

      const transactionTxid =
        paymentData?.transaction?.txid;

      if (
        transactionTxid &&
        transactionTxid !== cleanTxid
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

      const completeResponse =
        await piFetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(
            sdkPaymentId,
          )}/complete`,
          {
            method: "POST",
            headers: getPiHeaders(),
            body: JSON.stringify({
              txid: cleanTxid,
            }),
          },
        );

      const completeText =
        await completeResponse.text();

      const completeData =
        parseJson(completeText);

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

      const paidAt = new Date();

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

      logger.info(
        {
          paymentId: payment.id,
          piPaymentId:
            sdkPaymentId,
          txid: cleanTxid,
          orderId: order.id,
        },
        "Pi payment completed successfully",
      );

      res.json({
        success: true,
        status: "paid",
        paymentId: payment.id,
        piPaymentId:
          sdkPaymentId,
        txid: cleanTxid,
        orderId: order.id,
        message:
          "Pi payment verified and completed",
        data: completeData,
      });
    } catch (err) {
      logger.error(
        {
          err,
          paymentId: payment.id,
          piPaymentId:
            sdkPaymentId,
          orderId: order.id,
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

export default router;