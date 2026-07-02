import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { verifyToken } from "./utils/jwt.js";
import { findVoiceSession } from "./models/interviewModel.js";
import { attachVoiceProxy } from "./services/voiceProxy.js";

const server = http.createServer(createApp());

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

    // Ownership check: the interview must belong to this user.
    const session = await findVoiceSession(interviewId, userId);
    if (!session) return destroy(socket, 403);

    wss.handleUpgrade(req, socket, head, (client) => {
      attachVoiceProxy(client, {
        interviewId,
        type: session.type,
        user: {
          name: session.name,
          jobRole: session.job_role,
          experienceLevel: session.experience_level,
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
