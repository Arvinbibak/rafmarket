import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, signToken } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// POST /auth/pi - Authenticate with Pi Network
router.post("/auth/pi", async (req, res): Promise<void> => {
  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) {
    res.status(400).json({ error: "accessToken required" });
    return;
  }

  try {
    // Verify with Pi Network API
    const piRes = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!piRes.ok) {
      req.log.warn({ status: piRes.status }, "Pi auth failed");
      res.status(401).json({ error: "Invalid Pi access token" });
      return;
    }

    const piUser = (await piRes.json()) as { uid: string; username: string };

    // Upsert user
    let [user] = await db.select().from(usersTable).where(eq(usersTable.piUid, piUser.uid));

    if (!user) {
      const [created] = await db.insert(usersTable).values({
        piUid: piUser.uid,
        piUsername: piUser.username,
        role: "user",
      }).returning();
      user = created;
      req.log.info({ userId: user.id }, "New user registered");
    } else if (user.piUsername !== piUser.username) {
      const [updated] = await db.update(usersTable)
        .set({ piUsername: piUser.username })
        .where(eq(usersTable.id, user.id))
        .returning();
      user = updated;
    }

    const token = signToken({ id: user.id, piUsername: user.piUsername, role: user.role });

    res.json({
      user: {
        id: user.id,
        piUsername: user.piUsername,
        piUid: user.piUid,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    logger.error({ err }, "Pi auth error");
    res.status(500).json({ error: "Authentication failed" });
  }
});

// GET /auth/me
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    piUsername: user.piUsername,
    piUid: user.piUid,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    createdAt: user.createdAt,
  });
});

export default router;
