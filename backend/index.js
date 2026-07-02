import http from "node:http";
import { URL } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { verifyToken } from "./lib/jwt.js";
import { query } from "./db/pool.js";
import { authRouter } from "./routes/auth.js";
import { interviewsRouter } from "./routes/interviews.js";
import { attachVoiceProxy } from "./deepgram/voiceProxy.js";

const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/interviews", interviewsRouter);

const server = http.createServer(app);

// Voice WebSocket: /api/interviews/:id/voice?token=<jwt>
// We authenticate on the HTTP upgrade before the socket is accepted.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/interviews\/(\d+)\/voice$/);
    if (!match) return destroy(socket, 404);

    const interviewId = Number(match[1]);
    const token = url.searchParams.get("token");
    if (!token) return destroy(socket, 401);

    let userId;
    try {
      userId = verifyToken(token).sub;
    } catch {
      return destroy(socket, 401);
    }

    // Ownership check: the interview must belong to this user and be open.
    const { rows } = await query(
      `SELECT i.id, i.type, i.status, u.name, u.job_role, u.experience_level
         FROM interviews i JOIN users u ON u.id = i.user_id
        WHERE i.id = $1 AND i.user_id = $2`,
      [interviewId, userId]
    );
    const row = rows[0];
    if (!row) return destroy(socket, 403);

    wss.handleUpgrade(req, socket, head, (client) => {
      attachVoiceProxy(client, {
        interviewId,
        type: row.type,
        user: {
          name: row.name,
          jobRole: row.job_role,
          experienceLevel: row.experience_level,
        },
      });
    });
  } catch (err) {
    console.error("[upgrade]", err);
    destroy(socket, 500);
  }
});

function destroy(socket, code) {
  socket.write(`HTTP/1.1 ${code} \r\n\r\n`);
  socket.destroy();
}

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] LLM (Deepgram-managed): ${config.llm.type}/${config.llm.model}`);
});
