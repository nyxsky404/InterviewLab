import { query } from "../db/pool.js";

export async function createUser({ email, passwordHash, name, jobRole, experienceLevel }) {
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, name, job_role, experience_level)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, job_role, experience_level`,
    [email, passwordHash, name, jobRole, experienceLevel]
  );
  return rows[0];
}

export async function findUserByEmail(email) {
  const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}
