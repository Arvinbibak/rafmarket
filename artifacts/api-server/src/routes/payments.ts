import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";

import {
  db,
  ordersTable,
  sellerOrdersTable,
  paymentsTable,
  productsTable,
} from "@workspace/db";

import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* -------------------------------------------------------------------------- */
/* GET /payments/pi/connection-check                                          */
/* Read-only check: asks Pi for the app's incomplete server payments.         */
/* -------------------------------------------------------------------------- */

router.get(
  "/payments/pi/connection-check",
  requireAuth,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const response = await piFetch(
        `${PI_API_BASE}/payments/incomplete_server_payments`,
        {
          method: "GET",
          headers: getPiHeaders(),
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Pi Server API key diagnostic request was rejected",
        );
        res.status(502).json({
          success: false,
          connected: false,
          error:
            response.status === 401 || response.status === 403
              ? "Pi rejected the Server API key"
              : `Pi API returned HTTP ${response.status}`,
        });
        return;
      }

      // Do not return payment records or any credential-related data to the client.
      await response.text();
      res.json({
        success: true,
        connected: true,
        message: "Pi accepted the Server API key",
      });
    } catch (err) {
      logger.error(
        { err },
        "Pi Server API key diagnostic request failed",
      );
      res.status(502).json({
        success: false,
        connected: false,
        error: "Could not reach the Pi Platform API",
      });
    }
  },
);


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
  user_uid?: string;
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

    if (method === "pi") {
      res.status(409).json({
        error: "Pi payments must use the verified Pi SDK payment flow",
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
  async (req: Request, res: Response): Promise<void> => {
    const { orderId, paymentId, piPaymentId, amount } = req.body as {
      orderId?: unknown;
      paymentId?: unknown;
      piPaymentId?: unknown;
      amount?: unknown;
    };

    const parsedOrderId = parsePositiveInteger(orderId);
    const cleanPiPaymentId =
      typeof piPaymentId === "string"
        ? piPaymentId.trim()
        : typeof paymentId === "string"
          ? paymentId.trim()
          : "";
    const parsedAmount = parsePositiveNumber(amount);

    if (!parsedOrderId || !cleanPiPaymentId || !parsedAmount) {
      res.status(400).json({
        error: "Valid orderId, Pi paymentId and amount are required",
      });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(and(
        eq(ordersTable.id, parsedOrderId),
        eq(ordersTable.userId, req.user!.id),
      ));

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (order.status === "cancelled" || order.status === "paid") {
      res.status(409).json({ error: "Order is not awaiting payment" });
      return;
    }

    if (order.paymentMethod !== "pi" || order.currency !== "Pi") {
      res.status(409).json({ error: "This order is not configured for Pi payment" });
      return;
    }

    const expectedAmount = Number(order.total);
    if (!Number.isFinite(expectedAmount) ||
        Math.abs(parsedAmount - expectedAmount) > 0.00000001) {
      res.status(409).json({ error: "Payment amount does not match the order total" });
      return;
    }

    try {
      // Verify the payment details directly with Pi before approving it.
      const verifyResponse = await piFetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(cleanPiPaymentId)}`,
        { method: "GET", headers: getPiHeaders() },
      );
      const verifyText = await verifyResponse.text();
      const parsedPayment = parseJson(verifyText);
      const piPayment =
        parsedPayment && typeof parsedPayment === "object"
          ? parsedPayment as PiPaymentResponse
          : null;

      if (!verifyResponse.ok || !piPayment) {
        logger.warn(
          { status: verifyResponse.status, piPaymentId: cleanPiPaymentId, response: verifyText },
          "Pi payment details could not be verified before approval",
        );
        res.status(502).json({ error: "Could not verify payment details with Pi" });
        return;
      }

      if (piPayment.identifier !== cleanPiPaymentId) {
        res.status(409).json({ error: "Pi payment identifier does not match" });
        return;
      }

      if (
        piPayment.identifier !== cleanPiPaymentId ||
        !req.user!.piUid ||
        piPayment.user_uid !== req.user!.piUid
      ) {
        res.status(409).json({ error: "Pi payment does not belong to this Pi account" });
        return;
      }

      if (
        typeof piPayment.amount !== "number" ||
        !Number.isFinite(piPayment.amount) ||
        Math.abs(piPayment.amount - expectedAmount) > 0.00000001
      ) {
        res.status(409).json({ error: "Pi payment amount does not match the order total" });
        return;
      }

      const metadata =
        piPayment.metadata && typeof piPayment.metadata === "object"
          ? piPayment.metadata as Record<string, unknown>
          : null;
      if (!metadata || Number(metadata.orderId) !== order.id) {
        res.status(409).json({ error: "Pi payment metadata does not match this order" });
        return;
      }

      if (piPayment.status?.cancelled || piPayment.status?.user_cancelled) {
        res.status(409).json({ error: "Pi payment was cancelled" });
        return;
      }

      const [existingOrderPayment] = await db
        .select()
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.orderId, order.id),
          eq(paymentsTable.userId, req.user!.id),
        ));

      let payment: PaymentRecord | undefined;
      if (existingOrderPayment) {
        if (existingOrderPayment.providerPaymentId !== cleanPiPaymentId) {
          if (existingOrderPayment.status !== "cancelled") {
            res.status(409).json({ error: "This order already has a different payment attempt" });
            return;
          }

          const [reused] = await db.update(paymentsTable)
            .set({
              method: "pi",
              amount: String(expectedAmount),
              currency: "Pi",
              status: "pending",
              providerPaymentId: cleanPiPaymentId,
              providerReference: typeof piPayment.memo === "string" ? piPayment.memo : null,
              paidAt: null,
            })
            .where(eq(paymentsTable.id, existingOrderPayment.id))
            .returning();
          payment = reused;
        } else {
          payment = existingOrderPayment;
        }
      } else {
        payment = await findUserPayment(cleanPiPaymentId, req.user!.id);
      }

      if (
        payment &&
        (
          payment.orderId !== order.id ||
          payment.method !== "pi" ||
          payment.providerPaymentId !== cleanPiPaymentId ||
          payment.currency !== "Pi" ||
          Math.abs(Number(payment.amount) - expectedAmount) > 0.00000001 ||
          payment.status === "paid"
        )
      ) {
        res.status(409).json({ error: "Existing payment record does not match this Pi order" });
        return;
      }

      if (!payment) {
        const [created] = await db
          .insert(paymentsTable)
          .values({
            orderId: order.id,
            userId: req.user!.id,
            method: "pi",
            amount: String(expectedAmount),
            currency: "Pi",
            status: "pending",
            providerPaymentId: cleanPiPaymentId,
            providerReference: typeof piPayment.memo === "string" ? piPayment.memo : null,
          })
          .returning();
        payment = created;
      }

      if (!piPayment.status?.developer_approved) {
        const approveResponse = await piFetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(cleanPiPaymentId)}/approve`,
          { method: "POST", headers: getPiHeaders() },
        );
        const approveText = await approveResponse.text();

        if (!approveResponse.ok) {
          logger.warn(
            { status: approveResponse.status, piPaymentId: cleanPiPaymentId, response: approveText },
            "Pi payment server approval failed",
          );
          res.status(502).json({ error: "Pi payment server approval failed" });
          return;
        }
      }

      const approvalCheck = await piFetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(cleanPiPaymentId)}`,
        { method: "GET", headers: getPiHeaders() },
      );
      const approvalText = await approvalCheck.text();
      const approvalParsed = parseJson(approvalText);
      const approvedPayment =
        approvalParsed && typeof approvalParsed === "object"
          ? approvalParsed as PiPaymentResponse
          : null;
      const approvedMetadata =
        approvedPayment?.metadata && typeof approvedPayment.metadata === "object"
          ? approvedPayment.metadata as Record<string, unknown>
          : null;

      if (
        !approvalCheck.ok ||
        !approvedPayment ||
        approvedPayment.identifier !== cleanPiPaymentId ||
        !approvedPayment.status?.developer_approved ||
        approvedMetadata == null ||
        Number(approvedMetadata.orderId) !== order.id ||
        !Number.isFinite(Number(approvedPayment.amount)) ||
        Math.abs(Number(approvedPayment.amount) - expectedAmount) > 0.00000001
      ) {
        logger.warn(
          { status: approvalCheck.status, piPaymentId: cleanPiPaymentId, response: approvalText },
          "Pi server approval could not be confirmed",
        );
        res.status(502).json({ error: "Pi server approval could not be confirmed" });
        return;
      }

      await db
        .update(paymentsTable)
        .set({ status: "approved", providerPaymentId: cleanPiPaymentId })
        .where(eq(paymentsTable.id, payment.id));

      logger.info(
        { paymentId: payment.id, piPaymentId: cleanPiPaymentId, orderId: order.id },
        "Pi payment verified and approved by server",
      );

      res.json({
        success: true,
        status: "approved",
        paymentId: payment.id,
        piPaymentId: cleanPiPaymentId,
      });
    } catch (err) {
      logger.error(
        { err, piPaymentId: cleanPiPaymentId, orderId: order.id },
        "Pi payment verification or approval failed",
      );
      res.status(502).json({ error: "Unable to verify or approve Pi payment" });
    }
  },
);

/* -------------------------------------------------------------------------- */
/* POST /payments/pi/approve                                                  */
/* -------------------------------------------------------------------------- */

router.post(
  "/payments/pi/approve",
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json({
      error: "This legacy endpoint is disabled. Use /payments/pi/initiate for verified server-side approval.",
    });
  },
);

/* -------------------------------------------------------------------------- */
/* POST /payments/pi/complete                                                 */
/* -------------------------------------------------------------------------- */

router.post(
  "/payments/pi/complete",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { paymentId, piPaymentId, orderId, txid } = req.body as {
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
    const cleanTxid = typeof txid === "string" ? txid.trim() : "";

    if (!sdkPaymentId || !cleanTxid) {
      res.status(400).json({ error: "Pi paymentId and txid are required" });
      return;
    }

    const payment = await findUserPayment(sdkPaymentId, req.user!.id);
    if (!payment || payment.method !== "pi") {
      res.status(404).json({ error: "Pi payment not found" });
      return;
    }

    // Completion must use the exact provider ID, never a local database ID.
    if (payment.providerPaymentId !== sdkPaymentId) {
      res.status(409).json({ error: "Payment provider ID does not match" });
      return;
    }

    const [order] = await db
      .select()
      .from(ordersTable)
      .where(and(
        eq(ordersTable.id, payment.orderId),
        eq(ordersTable.userId, req.user!.id),
      ));

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (orderId != null && Number(orderId) !== order.id) {
      res.status(409).json({ error: "Payment does not belong to this order" });
      return;
    }

    if (order.status === "cancelled") {
      res.status(409).json({ error: "Order is cancelled" });
      return;
    }

    if (payment.status === "paid" || order.status === "paid") {
      if (
        payment.status === "paid" &&
        order.status === "paid" &&
        order.piPaymentId === sdkPaymentId &&
        order.piTxid === cleanTxid &&
        payment.providerReference === cleanTxid
      ) {
        res.json({
          success: true,
          status: "paid",
          paymentId: payment.id,
          piPaymentId: sdkPaymentId,
          txid: cleanTxid,
          orderId: order.id,
          idempotent: true,
        });
        return;
      }

      res.status(409).json({ error: "Order or payment is already completed with different details" });
      return;
    }

    const expectedAmount = Number(order.total);
    const recordedAmount = Number(payment.amount);
    if (
      order.paymentMethod !== "pi" ||
      order.currency !== "Pi" ||
      payment.currency !== "Pi" ||
      !Number.isFinite(expectedAmount) ||
      !Number.isFinite(recordedAmount) ||
      Math.abs(recordedAmount - expectedAmount) > 0.00000001
    ) {
      res.status(409).json({ error: "Local payment amount or currency does not match the order" });
      return;
    }

    try {
      const verifyResponse = await piFetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(sdkPaymentId)}`,
        { method: "GET", headers: getPiHeaders() },
      );
      const verifyText = await verifyResponse.text();
      const parsed = parseJson(verifyText);
      const piPayment =
        parsed && typeof parsed === "object"
          ? parsed as PiPaymentResponse
          : null;

      if (!verifyResponse.ok || !piPayment) {
        logger.warn(
          { status: verifyResponse.status, piPaymentId: sdkPaymentId, response: verifyText },
          "Pi payment lookup failed during completion",
        );
        res.status(502).json({ error: "Could not verify payment with Pi" });
        return;
      }

      if (
        piPayment.identifier !== sdkPaymentId ||
        !req.user!.piUid ||
        piPayment.user_uid !== req.user!.piUid
      ) {
        res.status(409).json({ error: "Pi payment does not belong to this Pi account" });
        return;
      }

      const piAmount = Number(piPayment.amount);
      if (!Number.isFinite(piAmount) || Math.abs(piAmount - expectedAmount) > 0.00000001) {
        res.status(409).json({ error: "Pi payment amount does not match the order total" });
        return;
      }

      const metadata =
        piPayment.metadata && typeof piPayment.metadata === "object"
          ? piPayment.metadata as Record<string, unknown>
          : null;
      if (!metadata || Number(metadata.orderId) !== order.id) {
        res.status(409).json({ error: "Pi payment metadata does not match this order" });
        return;
      }

      const piStatus = piPayment.status;
      if (piStatus?.cancelled || piStatus?.user_cancelled) {
        await db.update(paymentsTable)
          .set({ status: "cancelled" })
          .where(eq(paymentsTable.id, payment.id));
        res.status(409).json({ error: "Pi payment was cancelled" });
        return;
      }

      if (!piStatus?.developer_approved || !piStatus.transaction_verified) {
        res.status(409).json({ error: "Pi payment is not approved and transaction-verified yet" });
        return;
      }

      const verifiedTxid = piPayment.transaction?.txid;
      if (!verifiedTxid || verifiedTxid !== cleanTxid) {
        logger.warn(
          { piPaymentId: sdkPaymentId, expectedTxid: verifiedTxid ?? null, receivedTxid: cleanTxid },
          "Pi transaction ID is missing or does not match",
        );
        res.status(409).json({ error: "Transaction ID does not match the verified Pi transaction" });
        return;
      }

      // Pi may already have completed the payment if a previous request lost its response.
      if (!piStatus.developer_completed) {
        const completeResponse = await piFetch(
          `${PI_API_BASE}/payments/${encodeURIComponent(sdkPaymentId)}/complete`,
          {
            method: "POST",
            headers: getPiHeaders(),
            body: JSON.stringify({ txid: verifiedTxid }),
          },
        );
        const completeText = await completeResponse.text();
        if (!completeResponse.ok) {
          logger.warn(
            { status: completeResponse.status, piPaymentId: sdkPaymentId, response: completeText },
            "Pi payment completion request failed",
          );
          res.status(502).json({ error: "Pi payment completion failed; retry after checking payment status" });
          return;
        }
      }

      // Read Pi again after completion; local orders are paid only after Pi confirms it.
      const finalResponse = await piFetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(sdkPaymentId)}`,
        { method: "GET", headers: getPiHeaders() },
      );
      const finalText = await finalResponse.text();
      const finalParsed = parseJson(finalText);
      const finalPayment =
        finalParsed && typeof finalParsed === "object"
          ? finalParsed as PiPaymentResponse
          : null;

      if (
        !finalResponse.ok ||
        !finalPayment ||
        finalPayment.identifier !== sdkPaymentId ||
        !req.user!.piUid ||
        finalPayment.user_uid !== req.user!.piUid ||
        !finalPayment.status?.developer_completed ||
        !finalPayment.status.transaction_verified ||
        finalPayment.transaction?.txid !== verifiedTxid ||
        !Number.isFinite(Number(finalPayment.amount)) ||
        Math.abs(Number(finalPayment.amount) - expectedAmount) > 0.00000001
      ) {
        logger.warn(
          { status: finalResponse.status, piPaymentId: sdkPaymentId, response: finalText },
          "Pi did not confirm completed payment after completion request",
        );
        res.status(502).json({ error: "Pi has not confirmed final payment completion yet" });
        return;
      }

      const paidAt = new Date();
      await db.transaction(async (tx) => {
        await tx.update(paymentsTable)
          .set({
            status: "paid",
            providerPaymentId: sdkPaymentId,
            providerReference: verifiedTxid,
            paidAt,
          })
          .where(and(
            eq(paymentsTable.id, payment.id),
            eq(paymentsTable.userId, req.user!.id),
            eq(paymentsTable.orderId, order.id),
          ));

        await tx.update(ordersTable)
          .set({
            status: "paid",
            piPaymentId: sdkPaymentId,
            piTxid: verifiedTxid,
          })
          .where(and(
            eq(ordersTable.id, order.id),
            eq(ordersTable.userId, req.user!.id),
          ));

        await tx.update(sellerOrdersTable)
          .set({ status: "paid" })
          .where(eq(sellerOrdersTable.orderId, order.id));
      });

      logger.info(
        { paymentId: payment.id, piPaymentId: sdkPaymentId, txid: verifiedTxid, orderId: order.id },
        "Pi payment completed and confirmed",
      );

      res.json({
        success: true,
        status: "paid",
        paymentId: payment.id,
        piPaymentId: sdkPaymentId,
        txid: verifiedTxid,
        orderId: order.id,
        message: "Pi payment verified and completed",
      });
    } catch (err) {
      logger.error(
        { err, paymentId: payment.id, piPaymentId: sdkPaymentId, orderId: order.id },
        "Pi payment completion failed",
      );
      res.status(502).json({ error: "Unable to verify or complete Pi payment" });
    }
  },
);

/* -------------------------------------------------------------------------- */
/* POST /payments/pi/cancel                                                   */
/* -------------------------------------------------------------------------- */

router.post(
  "/payments/pi/cancel",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { paymentId, orderId } = req.body as {
      paymentId?: unknown;
      orderId?: unknown;
    };
    const cleanPiPaymentId = typeof paymentId === "string" ? paymentId.trim() : "";
    const parsedOrderId = parsePositiveInteger(orderId);

    if (!cleanPiPaymentId || !parsedOrderId) {
      res.status(400).json({ error: "Pi paymentId and valid orderId are required" });
      return;
    }

    const [order] = await db.select().from(ordersTable).where(and(
      eq(ordersTable.id, parsedOrderId),
      eq(ordersTable.userId, req.user!.id),
    ));

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (order.status === "cancelled") {
      res.json({ success: true, status: "cancelled", orderId: order.id, idempotent: true });
      return;
    }

    if (order.status === "paid" || order.status !== "pending") {
      res.status(409).json({ error: "Only unpaid pending orders can be cancelled" });
      return;
    }

    try {
      // The browser callback is not trusted: confirm cancellation with Pi itself.
      const piResponse = await piFetch(
        `${PI_API_BASE}/payments/${encodeURIComponent(cleanPiPaymentId)}`,
        { method: "GET", headers: getPiHeaders() },
      );
      const piText = await piResponse.text();
      const parsed = parseJson(piText);
      const piPayment =
        parsed && typeof parsed === "object"
          ? parsed as PiPaymentResponse
          : null;
      const metadata =
        piPayment?.metadata && typeof piPayment.metadata === "object"
          ? piPayment.metadata as Record<string, unknown>
          : null;

      if (
        !piResponse.ok ||
        !piPayment ||
        piPayment.identifier !== cleanPiPaymentId ||
        !req.user!.piUid ||
        piPayment.user_uid !== req.user!.piUid ||
        !metadata ||
        Number(metadata.orderId) !== order.id ||
        !Number.isFinite(Number(piPayment.amount)) ||
        Math.abs(Number(piPayment.amount) - Number(order.total)) > 0.00000001 ||
        !(piPayment.status?.cancelled || piPayment.status?.user_cancelled)
      ) {
        logger.warn(
          { status: piResponse.status, piPaymentId: cleanPiPaymentId, response: piText },
          "Pi cancellation could not be verified",
        );
        res.status(409).json({ error: "Pi has not confirmed cancellation for this order" });
        return;
      }

      await db.transaction(async (tx) => {
        const [cancelledOrder] = await tx.update(ordersTable)
          .set({ status: "cancelled" })
          .where(and(
            eq(ordersTable.id, order.id),
            eq(ordersTable.userId, req.user!.id),
            eq(ordersTable.status, "pending"),
          ))
          .returning({ id: ordersTable.id });

        if (!cancelledOrder) {
          throw new Error("Order status changed before cancellation could be committed");
        }

        const [payment] = await tx.select().from(paymentsTable).where(and(
          eq(paymentsTable.providerPaymentId, cleanPiPaymentId),
          eq(paymentsTable.userId, req.user!.id),
          eq(paymentsTable.orderId, order.id),
        ));

        if (payment && payment.status !== "paid") {
          await tx.update(paymentsTable)
            .set({ status: "cancelled" })
            .where(eq(paymentsTable.id, payment.id));
        }

        for (const item of order.items ?? []) {
          if (!Number.isInteger(item.productId) || !Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new Error("Order contains invalid product quantity data");
          }
          await tx.update(productsTable)
            .set({
              stock: sql`${productsTable.stock} + ${item.quantity}`,
              status: "active",
            })
            .where(eq(productsTable.id, item.productId));
        }

        await tx.update(sellerOrdersTable)
          .set({ status: "cancelled" })
          .where(eq(sellerOrdersTable.orderId, order.id));
      });

      logger.info(
        { orderId: order.id, piPaymentId: cleanPiPaymentId },
        "Cancelled Pi order and restored reserved stock",
      );

      res.json({
        success: true,
        status: "cancelled",
        orderId: order.id,
        message: "Pi cancellation verified; order cancelled and stock restored",
      });
    } catch (err) {
      logger.error(
        { err, orderId: order.id, piPaymentId: cleanPiPaymentId },
        "Pi payment cancellation failed",
      );
      res.status(502).json({ error: "Unable to cancel order safely" });
    }
  },
);


export default router;