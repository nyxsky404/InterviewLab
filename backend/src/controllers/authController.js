import bcrypt from "bcryptjs";
import { createUser, findUserByEmail, findUserById } from "../models/userModel.js";
import { signToken } from "../utils/jwt.js";

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

export async function signup(req, res) {
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
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser({
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
      jobRole: jobRole.trim(),
      experienceLevel,
    });
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error("[signup]", err);
    return res.status(500).json({ error: "Signup failed" });
  }
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  try {
    const user = await findUserByEmail(email.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ error: "Login failed" });
  }
}

// Current user (used by the client to restore session on refresh).
export async function me(req, res) {
  const user = await findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(user) });
}
