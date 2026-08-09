import { Router, type IRouter } from "express";
import { HealthStatus } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data: HealthStatus = { status: "ok" };
  res.json(data);
});

export default router;