import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const EXPERIENCE_LEVELS = ["junior", "mid", "senior", "staff"];

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    jobRole: row.job_role,
    experienceLevel: row.experience_level,
  };
}

authRouter.post("/signup", async (req, res) => {
  const { email, password, name, jobRole, experienceLevel } = req.body || {};

  if (!email || !password || !name || !jobRole || !experienceLevel) {
    return res
      .status(400)
      .json({ error: "email, password, name, jobRole, experienceLevel are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  if (!EXPERIENCE_LEVELS.includes(experienceLevel)) {
    return res
      .status(400)
      .json({ error: `experienceLevel must be one of: ${EXPERIENCE_LEVELS.join(", ")}` });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, name, job_role, experience_level)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, job_role, experience_level`,
      [email.toLowerCase().trim(), hash, name.trim(), jobRole.trim(), experienceLevel]
    );
    const user = rows[0];
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error("[signup]", err);
    return res.status(500).json({ error: "Signup failed" });
  }
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  try {
    const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [
      email.toLowerCase().trim(),
    ]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

// Current user (used by the client to restore session on refresh).
authRouter.get("/me", requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(rows[0]) });
});
