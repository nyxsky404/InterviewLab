import { Router } from "express";
import {
  create,
  list,
  getReport,
  finishAndGenerateFeedback,
  patchJd,
} from "../controllers/interviewController.js";
import { requireAuth } from "../middleware/verifyToken.js";

export const interviewRouter = Router();

interviewRouter.use(requireAuth);
interviewRouter.post("/", create);
interviewRouter.get("/", list);
interviewRouter.get("/:id", getReport);
interviewRouter.patch("/:id", patchJd);
interviewRouter.post("/:id/finish", finishAndGenerateFeedback);
