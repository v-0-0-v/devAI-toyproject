import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, WALLS, isWalkable, randomSpawnPoint } from "./map.js";
import type { Direction, Player, InitPayload } from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

const players: Record<string, Player> = {};

const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const PLAYER_COLORS = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0x8b5cf6, 0xec4899];

function pickColor(): number {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

io.on("connection", (socket) => {
  socket.on("join", (rawNickname: unknown) => {
    const nickname =
      typeof rawNickname === "string" && rawNickname.trim().length > 0
        ? rawNickname.trim().slice(0, 16)
        : `Guest-${socket.id.slice(0, 4)}`;

    const spawn = randomSpawnPoint();
    const player: Player = {
      id: socket.id,
      nickname,
      color: pickColor(),
      x: spawn.x,
      y: spawn.y,
    };
    players[socket.id] = player;

    const initPayload: InitPayload = {
      selfId: socket.id,
      players: { ...players },
      map: { width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, walls: WALLS },
    };
    socket.emit("init", initPayload);
    socket.broadcast.emit("player-joined", player);
  });

  socket.on("move", (direction: unknown) => {
    const player = players[socket.id];
    if (!player) return;
    if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
      return;
    }
    const { dx, dy } = DIRECTION_DELTA[direction];
    const nextX = player.x + dx;
    const nextY = player.y + dy;
    if (!isWalkable(nextX, nextY)) return;

    player.x = nextX;
    player.y = nextY;
    io.emit("player-moved", { id: socket.id, x: player.x, y: player.y });
  });

  socket.on("disconnect", () => {
    if (!players[socket.id]) return;
    delete players[socket.id];
    io.emit("player-left", { id: socket.id });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[zep-mini-mvp] server listening on http://localhost:${PORT}`);
});
