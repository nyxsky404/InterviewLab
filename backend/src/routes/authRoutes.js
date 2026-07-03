import { Router } from "express";
import { signup, login, logout, me, updateProfile } from "../controllers/authController.js";
import { requireAuth } from "../middleware/verifyToken.js";

export const authRouter = Router();

authRouter.post("/signup", signup);
authRouter.post("/login", login);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAuth, me);
authRouter.patch("/profile", requireAuth, updateProfile);
