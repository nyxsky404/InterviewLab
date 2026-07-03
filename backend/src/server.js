import http from "node:http";
import { URL } from "node:url";
import jwt from "jsonwebtoken";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { config } from "./config/config.js";
import { prisma } from "./data/prisma.js";
import { attachVoiceProxy } from "./services/voiceProxy.js";

const server = http.createServer(createApp());

// Voice WebSocket: /api/interviews/:id/voice
// Auth travels via the httpOnly "token" cookie (same-origin, sent automatically
// on the upgrade request) — we authenticate before the socket is accepted.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/interviews\/(\d+)\/voice$/);
    if (!match) return destroy(socket, 404);

    const interviewId = Number(match[1]);
    const token = parseCookie(req.headers.cookie).token;
    if (!token) return destroy(socket, 401);

    let userId;
    try {
      userId = jwt.verify(token, config.jwtSecret).userId;
    } catch {
      return destroy(socket, 401);
    }

    // Ownership check: the interview must belong to this user.
    const session = await prisma.interview.findFirst({
      where: { id: interviewId, userId: Number(userId) },
      include: { user: true },
    });
    if (!session) return destroy(socket, 403);

    wss.handleUpgrade(req, socket, head, (client) => {
      attachVoiceProxy(client, {
        interviewId,
        type: session.type,
        jdText: session.jdText || "",
        user: {
          name: session.user.name,
          jobRole: session.user.jobRole,
          experienceLevel: session.user.experienceLevel,
          resumeText: session.user.resumeText || "",
          skills: session.user.skills || "",
          yearsExperience: session.user.yearsExperience ?? null,
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

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] LLM (Deepgram-managed voice): ${config.llm.type}/${config.llm.model}`);
  console.log(
    `[server] interview brain: ${
      config.graph.enabled ? `LangGraph director (nodes on ${config.graph.model})` : "autonomous prompt (legacy)"
    }`
  );
});
