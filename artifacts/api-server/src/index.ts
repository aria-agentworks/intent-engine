import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./routes/voice/reminders.js";
import { createMediaStreamWss } from "./routes/voice/stream.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Create HTTP server so we can handle WebSocket upgrades alongside Express
const server = http.createServer(app);

// Twilio Media Streams WebSocket — mounted at /api/voice/stream
const mediaStreamWss = createMediaStreamWss();

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/api/voice/stream") {
    mediaStreamWss.handleUpgrade(req, socket, head, (ws) => {
      mediaStreamWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  logger.info("Twilio Media Streams WebSocket active at /api/voice/stream");
  startReminderScheduler();
});
