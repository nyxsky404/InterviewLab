import { Router } from "express";
import { create, list, detail, finish } from "../controllers/interviewController.js";
import { requireAuth } from "../middleware/auth.js";

export const interviewRouter = Router();

interviewRouter.use(requireAuth);
interviewRouter.post("/", create);
interviewRouter.get("/", list);
interviewRouter.get("/:id", detail);
interviewRouter.post("/:id/finish", finish);
