import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface AuthUser {
  id: number;
  piUsername: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET =
  process.env["SESSION_SECRET"] ??
  "rafmarket-secret-key";

export function signToken(
  user: AuthUser,
): string {
  return jwt.sign(
    user,
    JWT_SECRET,
    { expiresIn: "30d" },
  );
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader =
    req.headers.authorization;

  if (
    !authHeader?.startsWith(
      "Bearer ",
    )
  ) {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  const token =
    authHeader.slice(7);

  try {
    const payload =
      jwt.verify(
        token,
        JWT_SECRET,
      ) as AuthUser;

    const [user] =
      await db
        .select()
        .from(usersTable)
        .where(
          eq(
            usersTable.id,
            payload.id,
          ),
        );

    if (!user) {
      res.status(401).json({
        error:
          "User not found",
      });
      return;
    }

    req.user = {
      id: user.id,
      piUsername:
        user.piUsername,
      role: user.role,
    };

    next();
  } catch (err) {
    logger.warn(
      { err },
      "Invalid auth token",
    );

    res.status(401).json({
      error:
        "Invalid token",
    });
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader =
    req.headers.authorization;

  if (
    authHeader?.startsWith(
      "Bearer ",
    )
  ) {
    const token =
      authHeader.slice(7);

    try {
      const payload =
        jwt.verify(
          token,
          JWT_SECRET,
        ) as AuthUser;

      req.user = payload;
    } catch {
      // Ignore invalid optional authentication.
    }
  }

  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    !req.user ||
    req.user.role !== "admin"
  ) {
    res.status(403).json({
      error:
        "Admin access required",
    });
    return;
  }

  next();
}