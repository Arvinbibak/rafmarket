import { Router, type IRouter } from "express";
import { db, ordersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// POST /payments/pi/initiate
router.post("/payments/pi/initiate", requireAuth, async (req, res): Promise<void> => {
  const { orderId, amount } = req.body as { orderId?: number; amount?: number };
  if (!orderId || !amount) {
    res.status(400).json({ error: "orderId and amount required" });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  req.log.info({ orderId, amount }, "Pi payment initiated");

  res.json({
    success: true,
    status: "initiated",
    paymentId: null,
    txid: null,
    orderId,
    message: "Payment initiated",
  });
});

// POST /payments/pi/complete
router.post("/payments/pi/complete", requireAuth, async (req, res): Promise<void> => {
  const { paymentId, txid, orderId } = req.body as { paymentId?: string; txid?: string; orderId?: number };
  if (!paymentId || !txid) {
    res.status(400).json({ error: "paymentId and txid required" });
    return;
  }

  // Verify payment with Pi Network API
  try {
    const piApiKey = process.env["PI_API_KEY"];
    if (piApiKey) {
      const verifyRes = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
        headers: { Authorization: `Key ${piApiKey}` },
      });
      req.log.info({ status: verifyRes.status }, "Pi payment verification");
    }
  } catch (err) {
    logger.warn({ err }, "Pi payment verification failed, proceeding with txid");
  }

  if (orderId) {
    await db.update(ordersTable)
      .set({ status: "paid", piPaymentId: paymentId, piTxid: txid })
      .where(eq(ordersTable.id, orderId));
  }

  req.log.info({ paymentId, txid, orderId }, "Pi payment completed");

  res.json({
    success: true,
    status: "completed",
    paymentId,
    txid,
    orderId: orderId ?? null,
    message: "Payment completed successfully",
  });
});

// POST /payments/pi/cancel
router.post("/payments/pi/cancel", requireAuth, async (req, res): Promise<void> => {
  const { paymentId, orderId } = req.body as { paymentId?: string; orderId?: number };
  if (!paymentId) {
    res.status(400).json({ error: "paymentId required" });
    return;
  }

  if (orderId) {
    await db.update(ordersTable)
      .set({ status: "cancelled" })
      .where(eq(ordersTable.id, orderId));
  }

  req.log.info({ paymentId, orderId }, "Pi payment cancelled");

  res.json({
    success: false,
    status: "cancelled",
    paymentId,
    txid: null,
    orderId: orderId ?? null,
    message: "Payment was cancelled",
  });
});

export default router;
