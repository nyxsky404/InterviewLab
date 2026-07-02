import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { authRouter } from "./routes/authRoutes.js";
import { interviewRouter } from "./routes/interviewRoutes.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/interviews", interviewRouter);

  return app;
}
