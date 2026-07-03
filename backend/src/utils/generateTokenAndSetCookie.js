import jwt from "jsonwebtoken";
import { config } from "../config/config.js";

export const generateTokenAndSetCookie = (res, userId) => {
  const payload = { userId };
  const options = { expiresIn: "7d" };

  const token = jwt.sign(payload, config.jwtSecret, options);

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7d
  });

  return token;
};
