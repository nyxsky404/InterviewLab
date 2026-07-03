import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { config } from "../config/config.js";
import { prisma } from "../data/prisma.js";
import { generateTokenAndSetCookie } from "../utils/generateTokenAndSetCookie.js";

const EXPERIENCE_LEVELS = ["junior", "mid", "senior"];
const RESUME_MAX_CHARS = config.limits.resumeMaxChars;

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    jobRole: row.jobRole,
    experienceLevel: row.experienceLevel,
    skills: row.skills || "",
    yearsExperience: row.yearsExperience ?? null,
    resumeText: row.resumeText || "",
    hasResume: Boolean(row.resumeText && row.resumeText.trim()),
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
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        name: name.trim(),
        jobRole: jobRole.trim(),
        experienceLevel,
      },
    });
    generateTokenAndSetCookie(res, user.id);
    return res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error("[signup]", err);
    return res.status(500).json({ error: "Something went wrong. Try again in a moment." });
  }
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "That email or password doesn't look right." });
    }
    generateTokenAndSetCookie(res, user.id);
    return res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("[login]", err);
    return res.status(500).json({ error: "Something went wrong. Try again in a moment." });
  }
}

export async function logout(_req, res) {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  return res.status(200).json({ success: true, message: "Logged out successfully" });
}


export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: Number(req.userId) } });
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: publicUser(user) });
}

export async function updateProfile(req, res) {
  const b = req.body || {};

  if (b.experienceLevel != null && !EXPERIENCE_LEVELS.includes(b.experienceLevel)) {
    return res
      .status(400)
      .json({ error: `experienceLevel must be one of: ${EXPERIENCE_LEVELS.join(", ")}` });
  }

  let yearsExperience;
  if (b.yearsExperience != null && b.yearsExperience !== "") {
    const n = Number(b.yearsExperience);
    if (!Number.isFinite(n) || n < 0 || n > 60) {
      return res.status(400).json({ error: "yearsExperience must be a number between 0 and 60" });
    }
    yearsExperience = Math.round(n);
  }

  let resumeText;
  if (typeof b.resumeText === "string") {
    if (b.resumeText.length > RESUME_MAX_CHARS) {
      return res
        .status(400)
        .json({ error: `resumeText must be ${RESUME_MAX_CHARS.toLocaleString()} characters or fewer` });
    }
    resumeText = b.resumeText.trim();
  }

  try {
    const data = Object.fromEntries(
      Object.entries({
        name: b.name?.trim() || null,
        jobRole: b.jobRole?.trim() || null,
        experienceLevel: b.experienceLevel ?? null,
        resumeText: resumeText ?? null,
        skills: typeof b.skills === "string" ? b.skills.slice(0, 800).trim() : null,
        yearsExperience: yearsExperience ?? null,
      }).filter(([, value]) => value !== null && value !== undefined)
    );
    const updated = await prisma.user.update({ where: { id: Number(req.userId) }, data });
    if (!updated) return res.status(404).json({ error: "User not found" });
    return res.json({ user: publicUser(updated) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "User not found" });
    }
    console.error("[updateProfile]", err);
    return res.status(500).json({ error: "Could not update profile" });
  }
}
