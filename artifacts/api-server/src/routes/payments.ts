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