import { Router, type IRouter } from "express";
import { db, ordersTable, platformSettingsTable, productsTable, usersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

// GET /admin/stats
router.get("/admin/stats", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const [totalUsers, totalProducts, totalOrders, revenueResult, pendingOrders, activeProducts, recentOrderRows, statusCounts] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable),
    db.select({ count: sql<number>`count(*)::int` }).from(productsTable),
    db.select({ count: sql<number>`count(*)::int` }).from(ordersTable),
    db.select({ total: sql<number>`coalesce(sum(total::numeric), 0)::float` }).from(ordersTable).where(eq(ordersTable.status, "paid")),
    db.select({ count: sql<number>`count(*)::int` }).from(ordersTable).where(eq(ordersTable.status, "pending")),
    db.select({ count: sql<number>`count(*)::int` }).from(productsTable).where(eq(productsTable.status, "active")),
    db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(5),
    db.select({
      status: ordersTable.status,
      count: sql<number>`count(*)::int`,
    }).from(ordersTable).groupBy(ordersTable.status),
  ]);

  // Revenue by day (last 7 days)
  const revenueByDay = await db.execute(sql`
    SELECT
      to_char(created_at, 'YYYY-MM-DD') as date,
      coalesce(sum(total::numeric), 0)::float as revenue,
      count(*)::int as orders
    FROM orders
    WHERE created_at >= now() - interval '7 days'
    GROUP BY date
    ORDER BY date
  `);

  const recentOrders = recentOrderRows.map((order) => ({
    id: order.id,
    userId: order.userId,
    buyerUsername: null,
    items: order.items,
    total: parseFloat(order.total),
    currency: order.currency,
    status: order.status,
    piPaymentId: order.piPaymentId,
    piTxid: order.piTxid,
    shippingAddress: order.shippingAddress,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }));

  res.json({
    totalUsers: totalUsers[0].count,
    totalProducts: totalProducts[0].count,
    totalOrders: totalOrders[0].count,
    totalRevenue: revenueResult[0].total,
    pendingOrders: pendingOrders[0].count,
    activeProducts: activeProducts[0].count,
    recentOrders,
    ordersByStatus: statusCounts,
    revenueByDay: revenueByDay.rows as Array<{ date: string; revenue: number; orders: number }>,
  });
});

// GET /admin/orders
router.get("/admin/orders", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { status } = req.query as { status?: string };

  let rows = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  if (status) rows = rows.filter((r) => r.status === status);

  res.json(rows.map((order) => ({
    id: order.id,
    userId: order.userId,
    buyerUsername: null,
    items: order.items,
    total: parseFloat(order.total),
    currency: order.currency,
    status: order.status,
    piPaymentId: order.piPaymentId,
    piTxid: order.piTxid,
    shippingAddress: order.shippingAddress,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  })));
});

// GET /admin/users
router.get("/admin/users", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(users.map((u) => ({
    id: u.id,
    piUsername: u.piUsername,
    piUid: u.piUid,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    createdAt: u.createdAt,
  })));
});

 
// GET /admin/commission
// Returns the current marketplace commission. Five percent is the safe default.
router.get("/admin/commission", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const [setting] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "commission_percent"))
    .limit(1);

  res.json({
    commissionPercent: setting ? Number(setting.value) : 5,
  });
});

// PATCH /admin/commission
// Only administrators may change the rate. Keep the value bounded and numeric.
router.patch("/admin/commission", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const rawValue = (req.body as { commissionPercent?: unknown })?.commissionPercent;
  const commissionPercent =
    typeof rawValue === "number" ? rawValue :
    typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : NaN;

  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 30) {
    res.status(400).json({
      error: "commissionPercent must be a number between 0 and 30",
    });
    return;
  }

  const [setting] = await db
    .insert(platformSettingsTable)
    .values({
      key: "commission_percent",
      value: commissionPercent.toFixed(4),
    })
    .onConflictDoUpdate({
      target: platformSettingsTable.key,
      set: {
        value: commissionPercent.toFixed(4),
        updatedAt: new Date(),
      },
    })
    .returning();

  res.json({
    success: true,
    commissionPercent: Number(setting.value),
  });
});

export default router;
