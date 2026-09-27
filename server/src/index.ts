import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server, type DefaultEventsMap, type Socket } from "socket.io";
import {
  TILE_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
  WALLS,
  ROOMS,
  OBJECTS,
  PROXIMITY_RADIUS,
  isWalkable,
  randomSpawnPoint,
  roomIdAt,
} from "./map.js";
import { registerMapEditorRoutes } from "./mapEditor.js";
import { MemoryGameStore, type GameStore } from "./store.js";
import { initMediasoup, getRouter, createWebRtcTransport } from "./sfu.js";
import { ScriptSandbox, type ScriptHostCallbacks } from "./zepScript.js";
import type { Producer, Consumer, WebRtcTransport } from "mediasoup/types";
import {
  appendWhiteboardStroke,
  clearWhiteboardStrokes,
  getWhiteboardStrokes,
  insertReport,
  listRecentReports,
} from "./persistence.js";
import type {
  Direction,
  Player,
  InitPayload,
  ChatMessagePayload,
  ChatBroadcastPayload,
  ReactionPayload,
  WhiteboardStroke,
  ReportPayload,
  RpsChoice,
  AdminBanPayload,
  SfuCreateTransportPayload,
  SfuTransportOptions,
  SfuConnectTransportPayload,
  SfuProducePayload,
  SfuProduceResult,
  SfuConsumePayload,
  SfuConsumerOptions,
  SfuConsumePeerPayload,
  SfuConsumePeerResult,
  SfuResumeConsumerPayload,
  SfuCloseConsumersForPeerPayload,
} from "./types.js";

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

interface SocketData {
  isAdmin?: boolean;
}

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/health", (_req, res) => res.json({ ok: true }));
registerMapEditorRoutes(app, ADMIN_TOKEN);

const httpServer = createServer(app);
const io = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

// In-memory by default (zero extra infra for `npm run dev`); swapped for a
// Redis-backed store in main() below when REDIS_URL is set, so every
// horizontally-scaled instance shares one consistent view of the game state.
let store: GameStore = new MemoryGameStore();

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// The original synchronous version of this server never needed a lock: a
// socket event handler ran to completion in one tick, so two "move" events
// could never interleave. Making the store async (required for Redis)
// reintroduced that possibility — e.g. two updateProximity() calls for the
// same pair could both read "not yet in a call" before either had written
// its result, and both would emit a duplicate "proximity-joined". This
// mutex forces every handler that reads-then-writes shared state (join,
// move, disconnect) to run one at a time, restoring that same guarantee.
let mutex: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = mutex.then(fn, fn);
  mutex = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// Private rooms are "soundproof": two players only count as near each other
// if they're within radius AND in the same room (room 0 = the open floor),
// so a call never crosses a room wall even at point-blank range across it.
function isNear(a: Player, b: Player): boolean {
  if (roomIdAt(a.x, a.y) !== roomIdAt(b.x, b.y)) return false;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= PROXIMITY_RADIUS;
}

// Re-evaluates proximity between `playerId` and every other player, emitting
// "proximity-joined"/"proximity-left" to both sides of a pair whenever their
// in-call state changes. Called after a player spawns or moves.
async function updateProximity(playerId: string) {
  const player = await store.getPlayer(playerId);
  if (!player) return;

  const others = await store.allPlayers();
  for (const other of others) {
    if (other.id === playerId) continue;
    const key = pairKey(playerId, other.id);
    const near = isNear(player, other);
    const wasInCall = await store.hasCallPair(key);

    if (near && !wasInCall) {
      await store.addCallPair(key);
      io.to(playerId).emit("proximity-joined", { peerId: other.id, nickname: other.nickname });
      io.to(other.id).emit("proximity-joined", { peerId: playerId, nickname: player.nickname });
    } else if (!near && wasInCall) {
      await store.removeCallPair(key);
      io.to(playerId).emit("proximity-left", { peerId: other.id });
      io.to(other.id).emit("proximity-left", { peerId: playerId });
    }
  }
}

// Ends every call `playerId` is currently in, notifying the remaining peer.
// Called right before a disconnected player is removed.
async function endAllCallsFor(playerId: string) {
  const pairs = await store.allCallPairs();
  for (const key of pairs) {
    const [a, b] = key.split("|");
    if (a !== playerId && b !== playerId) continue;
    await store.removeCallPair(key);
    const other = a === playerId ? b : a;
    io.to(other).emit("proximity-left", { peerId: playerId });
  }
}

async function getNearbyPlayerIds(playerId: string): Promise<string[]> {
  const player = await store.getPlayer(playerId);
  if (!player) return [];
  const others = await store.allPlayers();
  return others.filter((other) => other.id !== playerId && isNear(player, other)).map((other) => other.id);
}

const CHAT_MAX_LEN = 200;
const REACTION_EMOJIS = new Set(["👍", "❤️", "😂", "😮", "👏", "🎉"]);
const WHITEBOARD_HISTORY_LIMIT = 500;
const ADMIN_REPORTS_LIMIT = 100;
const VALID_BOARD_IDS = new Set(OBJECTS.filter((o) => o.type === "whiteboard").map((o) => o.id));
const MINIGAME_OBJECT_IDS = new Set(OBJECTS.filter((o) => o.type === "minigame").map((o) => o.id));
const SCRIPT_OBJECTS = OBJECTS.filter((o) => o.type === "script");

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

// Trusts X-Forwarded-For because in this project's own production setup
// (deploy/Caddyfile) Caddy is the *only* thing that can reach this server —
// never expose this process directly to an untrusted reverse proxy.
function getClientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return socket.handshake.address;
}

// --- Rock-Paper-Scissors minigame (per-instance, in-memory only) ----------
// Deliberately NOT in GameStore: matching two waiting players is a
// "claim this slot" race that's trivial with a single in-memory Map but
// would need a Lua script/WATCH-MULTI to do safely over Redis. In a
// horizontally-scaled deployment, two players can only be matched if their
// sockets land on the same instance — an acceptable limitation for a mini
// minigame relative to the machinery needed to remove it.
interface RpsMatch {
  players: [string, string];
  choices: Partial<Record<string, RpsChoice>>;
}
const minigameWaiting = new Map<string, string>(); // objectId -> waiting socket id
const minigameMatches = new Map<string, RpsMatch>(); // matchId -> match
const minigameMatchByPlayer = new Map<string, string>(); // socket id -> matchId

function rpsWinner(a: RpsChoice, b: RpsChoice): "a" | "b" | "draw" {
  if (a === b) return "draw";
  const beats: Record<RpsChoice, RpsChoice> = { rock: "scissors", paper: "rock", scissors: "paper" };
  return beats[a] === b ? "a" : "b";
}

function cleanupMinigameFor(socketId: string) {
  for (const [objectId, waitingId] of minigameWaiting) {
    if (waitingId === socketId) minigameWaiting.delete(objectId);
  }
  const matchId = minigameMatchByPlayer.get(socketId);
  if (!matchId) return;
  const match = minigameMatches.get(matchId);
  minigameMatchByPlayer.delete(socketId);
  if (match) {
    const other = match.players.find((p) => p !== socketId);
    if (other) {
      io.to(other).emit("minigame-opponent-left");
      minigameMatchByPlayer.delete(other);
    }
  }
  minigameMatches.delete(matchId);
}

// --- mediasoup SFU peer state (per-instance, in-memory only) --------------
// Same accepted limitation as the minigame state above: transports/producers/
// consumers live on a specific worker process and aren't part of GameStore,
// so in a horizontally-scaled (Redis) deployment, media only flows between
// peers whose sockets land on the same instance.
interface SfuPeerState {
  rtpCapabilities?: unknown; // client's mediasoup-client Device.rtpCapabilities
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers: Map<"audio" | "video", Producer>;
  consumers: Map<string, Consumer>; // consumerId -> Consumer
}
const sfuPeers = new Map<string, SfuPeerState>(); // socket id -> state
const sfuProducerOwners = new Map<string, string>(); // producerId -> owning socket id

function getOrCreateSfuPeer(socketId: string): SfuPeerState {
  let peer = sfuPeers.get(socketId);
  if (!peer) {
    peer = { producers: new Map(), consumers: new Map() };
    sfuPeers.set(socketId, peer);
  }
  return peer;
}

function findSfuTransport(peer: SfuPeerState, transportId: string): WebRtcTransport | undefined {
  if (peer.sendTransport?.id === transportId) return peer.sendTransport;
  if (peer.recvTransport?.id === transportId) return peer.recvTransport;
  return undefined;
}

function cleanupSfuPeer(socketId: string) {
  const peer = sfuPeers.get(socketId);
  if (!peer) return;
  for (const producer of peer.producers.values()) {
    sfuProducerOwners.delete(producer.id);
    producer.close();
  }
  for (const consumer of peer.consumers.values()) consumer.close();
  peer.sendTransport?.close();
  peer.recvTransport?.close();
  sfuPeers.delete(socketId);
}

// --- ZEP Script (per-instance, in-memory only) ----------------------------
// Same accepted limitation as the SFU/minigame state above: a script's
// top-level `let`/`var` bindings (its persistent state — see zepScript.ts)
// live in one process's memory, not GameStore, so in a horizontally-scaled
// deployment each instance runs its own independent copy of every script.
const scriptSandboxes = new Map<string, ScriptSandbox>(); // objectId -> sandbox
const playerScriptObject = new Map<string, string | null>(); // socket id -> current script object id

function scriptObjectAt(x: number, y: number) {
  return SCRIPT_OBJECTS.find((o) => o.x === x && o.y === y);
}

// A script's $.say/$.broadcast reach clients through the "system" chat
// scope — the ordinary chat-message handler's scope allow-list already
// rejects "system" from a client, so a script can post as "시스템" but a
// player never can (see types.ts's ChatScope doc comment).
function scriptSay(playerId: string, text: string) {
  const trimmed = text.trim().slice(0, CHAT_MAX_LEN);
  if (!trimmed) return;
  const broadcast: ChatBroadcastPayload = { id: "system", nickname: "시스템", scope: "system", text: trimmed, ts: Date.now() };
  io.to(playerId).emit("chat-message", broadcast);
}

function scriptBroadcast(text: string) {
  const trimmed = text.trim().slice(0, CHAT_MAX_LEN);
  if (!trimmed) return;
  const broadcast: ChatBroadcastPayload = { id: "system", nickname: "시스템", scope: "system", text: trimmed, ts: Date.now() };
  io.emit("chat-message", broadcast);
}

// Shared by real player movement and $.teleport: both are "put this player
// at a validated position and re-run everything that depends on it."
// Assumes the caller already holds `mutex` (withLock) — it must NOT take
// the lock itself, or a script's teleport (which does take it, since that
// entry point isn't nested inside any handler) would deadlock against the
// move/join handler that's already holding it while awaiting this.
async function movePlayerTo(playerId: string, x: number, y: number) {
  if (!isWalkable(x, y)) return;
  const player = await store.getPlayer(playerId);
  if (!player) return;
  const previousPosition = { x: player.x, y: player.y };
  player.x = x;
  player.y = y;
  await store.setPlayer(player);
  io.emit("player-moved", { id: playerId, x: player.x, y: player.y });
  await updateProximity(playerId);
  await updateScriptTile(playerId, previousPosition, player);
}

async function updateScriptTile(socketId: string, previousPosition: { x: number; y: number }, player: Player) {
  const currentObj = scriptObjectAt(player.x, player.y);
  const previousObjId = playerScriptObject.get(socketId) ?? null;
  const currentObjId = currentObj?.id ?? null;
  if (currentObjId === previousObjId) return;

  if (previousObjId) {
    scriptSandboxes
      .get(previousObjId)
      ?.triggerLeave({ id: player.id, nickname: player.nickname, x: previousPosition.x, y: previousPosition.y });
  }
  playerScriptObject.set(socketId, currentObjId);
  if (currentObj) {
    scriptSandboxes.get(currentObj.id)?.triggerEnter({ id: player.id, nickname: player.nickname, x: player.x, y: player.y });
  }
}

const scriptHostCallbacks: ScriptHostCallbacks = {
  say: scriptSay,
  broadcast: scriptBroadcast,
  teleport: (playerId, x, y) => {
    void withLock(() => movePlayerTo(playerId, Math.trunc(x), Math.trunc(y)));
  },
};

io.on("connection", async (socket) => {
  await store.setSocketIp(socket.id, getClientIp(socket));
  if (await store.isBannedIp(getClientIp(socket))) {
    socket.disconnect(true);
    return;
  }

  // Accepts either a bare nickname string (legacy/back-compat, still used by
  // smoke-test.mjs) or {nickname, color} from the login form's color picker.
  socket.on("join", (raw: unknown) =>
    withLock(async () => {
      let rawNickname: unknown;
      let requestedColor: unknown;
      if (raw && typeof raw === "object") {
        rawNickname = (raw as Record<string, unknown>).nickname;
        requestedColor = (raw as Record<string, unknown>).color;
      } else {
        rawNickname = raw;
      }

      const nickname =
        typeof rawNickname === "string" && rawNickname.trim().length > 0
          ? rawNickname.trim().slice(0, 16)
          : `Guest-${socket.id.slice(0, 4)}`;

      const color =
        typeof requestedColor === "number" && PLAYER_COLORS.includes(requestedColor)
          ? requestedColor
          : pickColor();

      const spawn = randomSpawnPoint();
      const player: Player = {
        id: socket.id,
        nickname,
        color,
        x: spawn.x,
        y: spawn.y,
      };
      await store.setPlayer(player);

      const players: Record<string, Player> = {};
      for (const p of await store.allPlayers()) players[p.id] = p;

      const initPayload: InitPayload = {
        selfId: socket.id,
        players,
        map: {
          width: MAP_WIDTH,
          height: MAP_HEIGHT,
          tileSize: TILE_SIZE,
          walls: WALLS,
          rooms: ROOMS,
          objects: OBJECTS,
        },
      };
      socket.emit("init", initPayload);
      socket.broadcast.emit("player-joined", player);
      await updateProximity(socket.id);
      await updateScriptTile(socket.id, { x: player.x, y: player.y }, player);
    })
  );

  socket.on("move", (direction: unknown) =>
    withLock(async () => {
      const player = await store.getPlayer(socket.id);
      if (!player) return;
      if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
        return;
      }
      const { dx, dy } = DIRECTION_DELTA[direction];
      await movePlayerTo(socket.id, player.x + dx, player.y + dy);
    })
  );

  // --- mediasoup SFU signaling -------------------------------------------
  // Replaces the old per-pair WebRTC offer/answer/ICE relay (see sfu.ts's
  // doc comment). Request/response shaped, so these use Socket.IO acks
  // rather than fire-and-forget emits.
  socket.on("sfu-get-rtp-capabilities", (_payload: unknown, callback: (rtpCapabilities: unknown) => void) => {
    callback(getRouter().rtpCapabilities);
  });

  socket.on("sfu-set-rtp-capabilities", (rtpCapabilities: unknown, callback: (res: { ok: boolean }) => void) => {
    getOrCreateSfuPeer(socket.id).rtpCapabilities = rtpCapabilities;
    callback({ ok: true });
  });

  // Every handler below that calls into mediasoup wraps the call in
  // try/catch: mediasoup throws on malformed input (a bad dtlsParameters/
  // rtpParameters shape from a buggy or malicious client), and an exception
  // inside an async Socket.IO handler becomes an unhandled promise rejection
  // — which crashes the whole Node process by default, taking down every
  // connected player over one bad payload. Every other handler in this file
  // instead validates shape before trusting it; mediasoup's own inputs are
  // opaque RTP structures this server can't shape-check itself, so the only
  // guard available here is catching what mediasoup rejects with.
  socket.on(
    "sfu-create-transport",
    async (raw: unknown, callback: (options: SfuTransportOptions | null) => void) => {
      const direction = (raw as Partial<SfuCreateTransportPayload> | null)?.direction;
      if (direction !== "send" && direction !== "recv") {
        callback(null);
        return;
      }
      try {
        const transport = await createWebRtcTransport();
        const peer = getOrCreateSfuPeer(socket.id);
        if (direction === "send") peer.sendTransport = transport;
        else peer.recvTransport = transport;
        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        console.warn(`[sfu] create-transport failed for ${socket.id}:`, err);
        callback(null);
      }
    }
  );

  socket.on("sfu-connect-transport", async (raw: unknown, callback: (res: { ok: boolean }) => void) => {
    const payload = raw as Partial<SfuConnectTransportPayload> | null;
    const peer = sfuPeers.get(socket.id);
    const transport = peer && payload?.transportId ? findSfuTransport(peer, payload.transportId) : undefined;
    if (!transport || !payload) {
      callback({ ok: false });
      return;
    }
    try {
      await transport.connect({ dtlsParameters: payload.dtlsParameters as any });
      callback({ ok: true });
    } catch (err) {
      console.warn(`[sfu] connect-transport failed for ${socket.id}:`, err);
      callback({ ok: false });
    }
  });

  socket.on("sfu-produce", async (raw: unknown, callback: (res: SfuProduceResult | null) => void) => {
    const payload = raw as Partial<SfuProducePayload> | null;
    const peer = sfuPeers.get(socket.id);
    const transport = peer && payload?.transportId ? findSfuTransport(peer, payload.transportId) : undefined;
    if (!transport || !peer || !payload || (payload.kind !== "audio" && payload.kind !== "video")) {
      callback(null);
      return;
    }

    let producer: Producer;
    try {
      producer = await transport.produce({ kind: payload.kind, rtpParameters: payload.rtpParameters as any });
    } catch (err) {
      console.warn(`[sfu] produce failed for ${socket.id}:`, err);
      callback(null);
      return;
    }
    peer.producers.set(payload.kind, producer);
    sfuProducerOwners.set(producer.id, socket.id);
    callback({ id: producer.id });

    // Tell whoever already has a call/video-tile open with us (existing
    // call-pairs from proximity) about this new producer, so a producer that
    // finishes initializing slightly after proximity-joined already fired
    // still reaches them — matches what an offer would've done in the old
    // P2P flow.
    for (const key of await store.allCallPairs()) {
      const [a, b] = key.split("|");
      if (a !== socket.id && b !== socket.id) continue;
      const otherId = a === socket.id ? b : a;
      io.to(otherId).emit("sfu-new-producer", { peerId: socket.id, producerId: producer.id, kind: payload.kind });
    }
  });

  socket.on("sfu-consume", async (raw: unknown, callback: (res: SfuConsumerOptions | null) => void) => {
    const payload = raw as Partial<SfuConsumePayload> | null;
    const peer = sfuPeers.get(socket.id);
    const producerId = payload?.producerId;
    const ownerId = producerId ? sfuProducerOwners.get(producerId) : undefined;
    if (!peer?.recvTransport || !producerId || !ownerId || !peer.rtpCapabilities) {
      callback(null);
      return;
    }
    if (!getRouter().canConsume({ producerId, rtpCapabilities: peer.rtpCapabilities as any })) {
      callback(null);
      return;
    }

    try {
      const consumer = await peer.recvTransport.consume({
        producerId,
        rtpCapabilities: peer.rtpCapabilities as any,
        paused: true,
      });
      peer.consumers.set(consumer.id, consumer);
      callback({
        id: consumer.id,
        producerId,
        peerId: ownerId,
        kind: consumer.kind as "audio" | "video",
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.warn(`[sfu] consume failed for ${socket.id}:`, err);
      callback(null);
    }
  });

  socket.on("sfu-consume-peer", async (raw: unknown, callback: (res: SfuConsumePeerResult) => void) => {
    const payload = raw as Partial<SfuConsumePeerPayload> | null;
    const peer = sfuPeers.get(socket.id);
    const targetId = payload?.peerId;
    const targetPeer = targetId ? sfuPeers.get(targetId) : undefined;
    if (!peer?.recvTransport || !targetPeer || !peer.rtpCapabilities) {
      callback({ consumers: [] });
      return;
    }

    const results: SfuConsumerOptions[] = [];
    for (const producer of targetPeer.producers.values()) {
      if (!getRouter().canConsume({ producerId: producer.id, rtpCapabilities: peer.rtpCapabilities as any })) continue;
      try {
        const consumer = await peer.recvTransport.consume({
          producerId: producer.id,
          rtpCapabilities: peer.rtpCapabilities as any,
          paused: true,
        });
        peer.consumers.set(consumer.id, consumer);
        results.push({
          id: consumer.id,
          producerId: producer.id,
          peerId: targetId!,
          kind: consumer.kind as "audio" | "video",
          rtpParameters: consumer.rtpParameters,
        });
      } catch (err) {
        console.warn(`[sfu] consume-peer failed for ${socket.id} (producer ${producer.id}):`, err);
      }
    }
    callback({ consumers: results });
  });

  socket.on("sfu-resume-consumer", async (raw: unknown, callback: (res: { ok: boolean }) => void) => {
    const payload = raw as Partial<SfuResumeConsumerPayload> | null;
    const consumer = payload?.consumerId ? sfuPeers.get(socket.id)?.consumers.get(payload.consumerId) : undefined;
    if (!consumer) {
      callback({ ok: false });
      return;
    }
    try {
      await consumer.resume();
      callback({ ok: true });
    } catch (err) {
      console.warn(`[sfu] resume-consumer failed for ${socket.id}:`, err);
      callback({ ok: false });
    }
  });

  socket.on("sfu-close-consumers-for-peer", (raw: unknown, callback: (res: { ok: boolean }) => void) => {
    const payload = raw as Partial<SfuCloseConsumersForPeerPayload> | null;
    const peer = sfuPeers.get(socket.id);
    if (!peer || !payload?.peerId) {
      callback({ ok: false });
      return;
    }
    for (const [id, consumer] of [...peer.consumers]) {
      if (sfuProducerOwners.get(consumer.producerId) === payload.peerId) {
        consumer.close();
        peer.consumers.delete(id);
      }
    }
    callback({ ok: true });
  });

  // Chat: "global" reaches everyone, "nearby" reaches only players currently
  // within PROXIMITY_RADIUS (mirrors who'd be in a video call with the sender).
  socket.on("chat-message", async (raw: unknown) => {
    const player = await store.getPlayer(socket.id);
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
      for (const peerId of await getNearbyPlayerIds(socket.id)) {
        io.to(peerId).emit("chat-message", broadcast);
      }
    }
  });

  socket.on("reaction", async (raw: unknown) => {
    if (!(await store.getPlayer(socket.id))) return;
    const payload = raw as Partial<ReactionPayload> | null;
    const emoji = payload?.emoji;
    if (typeof emoji !== "string" || !REACTION_EMOJIS.has(emoji)) return;
    io.emit("reaction", { id: socket.id, emoji });
  });

  // Whiteboard: strokes are relayed to everyone (like reactions) and kept as
  // per-board history so a client opening the board later can catch up.
  socket.on("whiteboard-join", async (rawBoardId: unknown) => {
    if (typeof rawBoardId !== "string" || !VALID_BOARD_IDS.has(rawBoardId)) return;
    let strokes = await store.getWhiteboardHistory(rawBoardId);
    // The GameStore (memory or Redis) only holds what's been drawn since the
    // last restart. If it's empty, this may be a cold start rather than a
    // genuinely blank board — fall back to the durable SQLite log and warm
    // the store back up so later joins don't need to hit the DB again.
    if (strokes.length === 0) {
      const persisted = getWhiteboardStrokes(rawBoardId, WHITEBOARD_HISTORY_LIMIT);
      if (persisted.length > 0) {
        for (const stroke of persisted) await store.pushWhiteboardStroke(rawBoardId, stroke, WHITEBOARD_HISTORY_LIMIT);
        strokes = persisted;
      }
    }
    socket.emit("whiteboard-history", { boardId: rawBoardId, strokes });
  });

  socket.on("whiteboard-draw", async (raw: unknown) => {
    if (!(await store.getPlayer(socket.id))) return;
    const stroke = raw as Partial<WhiteboardStroke> | null;
    if (
      !stroke ||
      typeof stroke.boardId !== "string" ||
      !VALID_BOARD_IDS.has(stroke.boardId) ||
      typeof stroke.x0 !== "number" ||
      typeof stroke.y0 !== "number" ||
      typeof stroke.x1 !== "number" ||
      typeof stroke.y1 !== "number" ||
      typeof stroke.color !== "string"
    ) {
      return;
    }

    const validated: WhiteboardStroke = {
      boardId: stroke.boardId,
      x0: stroke.x0,
      y0: stroke.y0,
      x1: stroke.x1,
      y1: stroke.y1,
      color: stroke.color.slice(0, 16),
    };

    await store.pushWhiteboardStroke(validated.boardId, validated, WHITEBOARD_HISTORY_LIMIT);
    appendWhiteboardStroke(validated);
    io.emit("whiteboard-draw", validated);
  });

  socket.on("whiteboard-clear", async (rawBoardId: unknown) => {
    if (typeof rawBoardId !== "string" || !VALID_BOARD_IDS.has(rawBoardId)) return;
    await store.clearWhiteboardHistory(rawBoardId);
    clearWhiteboardStrokes(rawBoardId);
    io.emit("whiteboard-clear", { boardId: rawBoardId });
  });

  // Minimal moderation: log a structured report server-side, both to the
  // console and to the persisted report log an admin can read (admin-list-reports).
  socket.on("report", async (raw: unknown) => {
    const reporter = await store.getPlayer(socket.id);
    if (!reporter) return;
    const payload = raw as Partial<ReportPayload> | null;
    if (!payload || typeof payload.targetId !== "string") return;
    const target = await store.getPlayer(payload.targetId);
    if (!target) return;

    const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 200) : "";
    console.warn(
      `[report] ${reporter.nickname} (${socket.id}) reported ${target.nickname} (${target.id})` +
        (reason ? ` — reason: ${reason}` : "")
    );
    insertReport({
      reporterId: socket.id,
      reporterNickname: reporter.nickname,
      targetId: target.id,
      targetNickname: target.nickname,
      reason,
    });
  });

  // Server-enforced moderation: an admin (holder of ADMIN_TOKEN) can ban a
  // player's IP outright. Unlike Tier 2's client-local block, this survives
  // reloads/other tabs and is enforced at connection time (above), and with
  // Redis configured it's shared across every instance.
  socket.on("admin-auth", (raw: unknown) => {
    const token = typeof raw === "string" ? raw : (raw as Record<string, unknown> | null)?.token;
    const ok = Boolean(ADMIN_TOKEN) && token === ADMIN_TOKEN;
    socket.data.isAdmin = ok;
    socket.emit("admin-auth-result", { ok });
  });

  socket.on("admin-ban", async (raw: unknown) => {
    if (!socket.data.isAdmin) return;
    const payload = raw as Partial<AdminBanPayload> | null;
    if (!payload || typeof payload.targetId !== "string") return;

    const ip = await store.getSocketIp(payload.targetId);
    if (!ip) return;

    await store.banIp(ip);
    console.warn(`[admin] ${socket.id} banned ip ${ip} (target ${payload.targetId})`);
    io.to(payload.targetId).emit("admin-banned");
    await io.in(payload.targetId).disconnectSockets(true);
  });

  // Surfaces the persisted report log (see the "report" handler above) to an
  // authenticated admin — otherwise it's a write-only audit trail nobody reads.
  socket.on("admin-list-reports", () => {
    if (!socket.data.isAdmin) return;
    socket.emit("admin-reports", { reports: listRecentReports(ADMIN_REPORTS_LIMIT) });
  });

  // Rock-Paper-Scissors: walking onto a "minigame" object tile queues you for
  // the next opponent who also walks up, or matches you with whoever's
  // already waiting there.
  socket.on("minigame-join", (rawObjectId: unknown) => {
    if (typeof rawObjectId !== "string" || !MINIGAME_OBJECT_IDS.has(rawObjectId)) return;
    if (minigameMatchByPlayer.has(socket.id)) return;

    const waitingId = minigameWaiting.get(rawObjectId);
    if (!waitingId || waitingId === socket.id) {
      minigameWaiting.set(rawObjectId, socket.id);
      socket.emit("minigame-waiting", { objectId: rawObjectId });
      return;
    }

    minigameWaiting.delete(rawObjectId);
    const matchId = `${rawObjectId}:${Date.now()}:${Math.random()}`;
    const match: RpsMatch = { players: [waitingId, socket.id], choices: {} };
    minigameMatches.set(matchId, match);
    minigameMatchByPlayer.set(waitingId, matchId);
    minigameMatchByPlayer.set(socket.id, matchId);
    for (const playerId of match.players) {
      io.to(playerId).emit("minigame-matched", { objectId: rawObjectId });
    }
  });

  socket.on("minigame-choice", (raw: unknown) => {
    const payload = raw as Partial<{ choice: string }> | null;
    const choice = payload?.choice;
    if (choice !== "rock" && choice !== "paper" && choice !== "scissors") return;

    const matchId = minigameMatchByPlayer.get(socket.id);
    if (!matchId) return;
    const match = minigameMatches.get(matchId);
    if (!match) return;

    match.choices[socket.id] = choice;
    const [a, b] = match.players;
    const choiceA = match.choices[a];
    const choiceB = match.choices[b];
    if (!choiceA || !choiceB) return; // waiting on the other player

    const outcome = rpsWinner(choiceA, choiceB);
    io.to(a).emit("minigame-result", {
      yourChoice: choiceA,
      opponentChoice: choiceB,
      outcome: outcome === "draw" ? "draw" : outcome === "a" ? "win" : "lose",
    });
    io.to(b).emit("minigame-result", {
      yourChoice: choiceB,
      opponentChoice: choiceA,
      outcome: outcome === "draw" ? "draw" : outcome === "b" ? "win" : "lose",
    });
    match.choices = {}; // ready for another round with the same opponent
  });

  socket.on("minigame-leave", () => {
    cleanupMinigameFor(socket.id);
  });

  socket.on("disconnect", () =>
    withLock(async () => {
      cleanupSfuPeer(socket.id);
      const player = await store.getPlayer(socket.id);
      if (!player) return;
      const currentScriptObjectId = playerScriptObject.get(socket.id);
      if (currentScriptObjectId) {
        scriptSandboxes
          .get(currentScriptObjectId)
          ?.triggerLeave({ id: player.id, nickname: player.nickname, x: player.x, y: player.y });
      }
      playerScriptObject.delete(socket.id);
      cleanupMinigameFor(socket.id);
      await endAllCallsFor(socket.id);
      await store.deletePlayer(socket.id);
      await store.deleteSocketIp(socket.id);
      io.emit("player-left", { id: socket.id });
    })
  );
});

async function main() {
  await initMediasoup();

  for (const obj of SCRIPT_OBJECTS) {
    if (!obj.code) continue;
    const sandbox = await ScriptSandbox.create(obj.id, obj.code, scriptHostCallbacks);
    if (sandbox.loadError) {
      console.warn(`[zep-script:${obj.id}] failed to load, object is now inert: ${sandbox.loadError}`);
    }
    scriptSandboxes.set(obj.id, sandbox);
  }
  if (SCRIPT_OBJECTS.length > 0) {
    console.log(`[zep-mini-mvp] loaded ${SCRIPT_OBJECTS.length} ZEP Script object(s)`);
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const [{ Redis }, { createAdapter }, { RedisGameStore }] = await Promise.all([
      import("ioredis"),
      import("@socket.io/redis-adapter"),
      import("./redisStore.js"),
    ]);
    const pubClient = new Redis(redisUrl);
    const subClient = pubClient.duplicate();
    const dataClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    store = new RedisGameStore(dataClient);
    console.log(`[zep-mini-mvp] Redis adapter + shared game state connected (${redisUrl})`);
  } else {
    console.log("[zep-mini-mvp] REDIS_URL not set — running single-instance with in-memory state");
  }

  httpServer.listen(PORT, () => {
    console.log(`[zep-mini-mvp] server listening on http://localhost:${PORT}`);
  });
}

main();
