import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  TILE_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
  WALLS,
  PROXIMITY_RADIUS,
  isWalkable,
  randomSpawnPoint,
} from "./map.js";
import { buildIceServers } from "./turn.js";
import type {
  Direction,
  Player,
  InitPayload,
  OfferPayload,
  AnswerPayload,
  IceCandidatePayload,
  ChatMessagePayload,
  ChatBroadcastPayload,
  ReactionPayload,
} from "./types.js";

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

// Pair keys ("idA|idB", sorted) of players currently close enough to be in a call.
const inCallPairs = new Set<string>();

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function isNear(a: Player, b: Player): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= PROXIMITY_RADIUS;
}

// Re-evaluates proximity between `playerId` and every other player, emitting
// "proximity-joined"/"proximity-left" to both sides of a pair whenever their
// in-call state changes. Called after a player spawns or moves.
function updateProximity(playerId: string) {
  const player = players[playerId];
  if (!player) return;

  for (const other of Object.values(players)) {
    if (other.id === playerId) continue;
    const key = pairKey(playerId, other.id);
    const near = isNear(player, other);
    const wasInCall = inCallPairs.has(key);

    if (near && !wasInCall) {
      inCallPairs.add(key);
      io.to(playerId).emit("proximity-joined", { peerId: other.id, nickname: other.nickname });
      io.to(other.id).emit("proximity-joined", { peerId: playerId, nickname: player.nickname });
    } else if (!near && wasInCall) {
      inCallPairs.delete(key);
      io.to(playerId).emit("proximity-left", { peerId: other.id });
      io.to(other.id).emit("proximity-left", { peerId: playerId });
    }
  }
}

// Ends every call `playerId` is currently in, notifying the remaining peer.
// Called right before a disconnected player is removed.
function endAllCallsFor(playerId: string) {
  for (const key of [...inCallPairs]) {
    const [a, b] = key.split("|");
    if (a !== playerId && b !== playerId) continue;
    inCallPairs.delete(key);
    const other = a === playerId ? b : a;
    io.to(other).emit("proximity-left", { peerId: playerId });
  }
}

function getNearbyPlayerIds(playerId: string): string[] {
  const player = players[playerId];
  if (!player) return [];
  return Object.values(players)
    .filter((other) => other.id !== playerId && isNear(player, other))
    .map((other) => other.id);
}

const CHAT_MAX_LEN = 200;
const REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "👏", "🎉"]);

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
      iceServers: buildIceServers(socket.id),
    };
    socket.emit("init", initPayload);
    socket.broadcast.emit("player-joined", player);
    updateProximity(socket.id);
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
    updateProximity(socket.id);
  });

  // WebRTC signaling relay: the server never inspects offers/answers/ICE
  // candidates, it just forwards them to the intended peer by socket id.
  socket.on("webrtc-offer", ({ to, offer }: OfferPayload) => {
    if (typeof to !== "string") return;
    io.to(to).emit("webrtc-offer", { from: socket.id, offer });
  });

  socket.on("webrtc-answer", ({ to, answer }: AnswerPayload) => {
    if (typeof to !== "string") return;
    io.to(to).emit("webrtc-answer", { from: socket.id, answer });
  });

  socket.on("webrtc-ice-candidate", ({ to, candidate }: IceCandidatePayload) => {
    if (typeof to !== "string") return;
    io.to(to).emit("webrtc-ice-candidate", { from: socket.id, candidate });
  });

  // Chat: "global" reaches everyone, "nearby" reaches only players currently
  // within PROXIMITY_RADIUS (mirrors who'd be in a video call with the sender).
  socket.on("chat-message", (raw: unknown) => {
    const player = players[socket.id];
    if (!player) return;

    const payload = raw as Partial<ChatMessagePayload> | null;
    if (!payload || (payload.scope !== "global" && payload.scope !== "nearby")) return;
    const text = typeof payload.text === "string" ? payload.text.trim().slice(0, CHAT_MAX_LEN) : "";
    if (!text) return;

    const broadcast: ChatBroadcastPayload = {
      id: socket.id,
      nickname: player.nickname,
      scope: payload.scope,
      text,
      ts: Date.now(),
    };

    if (payload.scope === "global") {
      io.emit("chat-message", broadcast);
    } else {
      socket.emit("chat-message", broadcast);
      for (const peerId of getNearbyPlayerIds(socket.id)) {
        io.to(peerId).emit("chat-message", broadcast);
      }
    }
  });

  socket.on("reaction", (raw: unknown) => {
    if (!players[socket.id]) return;
    const payload = raw as Partial<ReactionPayload> | null;
    const emoji = payload?.emoji;
    if (typeof emoji !== "string" || !REACTION_EMOJIS.has(emoji)) return;
    io.emit("reaction", { id: socket.id, emoji });
  });

  socket.on("disconnect", () => {
    if (!players[socket.id]) return;
    endAllCallsFor(socket.id);
    delete players[socket.id];
    io.emit("player-left", { id: socket.id });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[zep-mini-mvp] server listening on http://localhost:${PORT}`);
});
