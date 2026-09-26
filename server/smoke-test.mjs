import "dotenv/config";
import { io } from "socket.io-client";

const a = io("http://localhost:3001", { transports: ["websocket"] });
const b = io("http://localhost:3001", { transports: ["websocket"] });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let aInit, bSawJoin, aSawMove;
let bSawOffer, aSawAnswer, bSawIceCandidate;
let aSawProximityJoin, bSawProximityJoin;
let aSawGlobalChat, bSawGlobalChat, aSawNearbyChat, bSawNearbyChat, aSawReaction, bSawReaction;
let aProximityLeftCount = 0;
let bProximityLeftCount = 0;
let bSawRoomCrossChat = false;
let aWhiteboardHistory, bSawWhiteboardDraw, aSawWhiteboardClear;

a.on("init", (payload) => {
  aInit = payload;
  console.log("A init selfId:", payload.selfId, "players:", Object.keys(payload.players).length);
});

b.on("player-joined", (player) => {
  bSawJoin = player;
  console.log("B saw player-joined:", player.nickname, player.x, player.y);
});

a.on("player-moved", (payload) => {
  aSawMove = payload;
});

b.on("webrtc-offer", (payload) => {
  bSawOffer = payload;
  console.log("B saw webrtc-offer from:", payload.from, "sdp:", payload.offer.sdp);
});

a.on("webrtc-answer", (payload) => {
  aSawAnswer = payload;
  console.log("A saw webrtc-answer from:", payload.from, "sdp:", payload.answer.sdp);
});

b.on("webrtc-ice-candidate", (payload) => {
  bSawIceCandidate = payload;
  console.log("B saw webrtc-ice-candidate from:", payload.from, "candidate:", payload.candidate.candidate);
});

a.on("proximity-joined", (payload) => {
  aSawProximityJoin = payload;
  console.log("A saw proximity-joined:", payload);
});

b.on("proximity-joined", (payload) => {
  bSawProximityJoin = payload;
  console.log("B saw proximity-joined:", payload);
});

a.on("proximity-left", () => aProximityLeftCount++);
b.on("proximity-left", () => bProximityLeftCount++);

a.on("chat-message", (payload) => {
  if (payload.scope === "global") aSawGlobalChat = payload;
  else aSawNearbyChat = payload;
});
b.on("chat-message", (payload) => {
  if (payload.scope === "global") bSawGlobalChat = payload;
  else if (payload.text === "should not cross the room wall") bSawRoomCrossChat = true;
  else bSawNearbyChat = payload;
});

a.on("reaction", (payload) => {
  aSawReaction = payload;
});
b.on("reaction", (payload) => {
  bSawReaction = payload;
});

a.on("whiteboard-history", (payload) => {
  aWhiteboardHistory = payload;
});
b.on("whiteboard-draw", (payload) => {
  bSawWhiteboardDraw = payload;
});
a.on("whiteboard-clear", (payload) => {
  aSawWhiteboardClear = payload;
});

a.on("connect", () => a.emit("join", "Alice"));

async function main() {
  await wait(500);
  b.emit("join", "Bob");
  await wait(500);

  // --- move/collision broadcast ---
  a.emit("move", "up");
  a.emit("move", "down");
  a.emit("move", "left");
  a.emit("move", "right");
  await wait(300);

  // --- WebRTC signaling relay (server treats payloads as opaque) ---
  a.emit("webrtc-offer", { to: b.id, offer: { type: "offer", sdp: "test-sdp-offer" } });
  await wait(200);
  b.emit("webrtc-answer", { to: a.id, answer: { type: "answer", sdp: "test-sdp-answer" } });
  await wait(200);
  a.emit("webrtc-ice-candidate", { to: b.id, candidate: { candidate: "test-candidate" } });
  await wait(200);

  // --- proximity: walk both players toward the open top-left corner (1,1) ---
  // so they end up next to each other regardless of their random spawn point.
  for (let i = 0; i < 25; i++) {
    a.emit("move", "up");
    a.emit("move", "left");
    b.emit("move", "up");
    b.emit("move", "left");
  }
  await wait(800);
  // Snapshot now: Carol/Dave join later at random spawn points and can
  // coincidentally wander within radius of A or B, firing a new
  // "proximity-joined" that would otherwise overwrite this before we assert.
  const aSawProximityJoinOriginal = aSawProximityJoin;
  const bSawProximityJoinOriginal = bSawProximityJoin;

  // --- chat: global reaches both regardless of position; nearby reaches both
  // only because the proximity walk above already put them next to each other ---
  a.emit("chat-message", { scope: "global", text: "hello everyone" });
  await wait(200);
  a.emit("chat-message", { scope: "nearby", text: "hey neighbor" });
  await wait(200);
  // Snapshot now: the room-isolation test below sends another "nearby"
  // message later, which would otherwise overwrite these before we assert.
  const aSawNearbyChatOriginal = aSawNearbyChat;
  const bSawNearbyChatOriginal = bSawNearbyChat;

  // --- reaction: broadcast to all players, including the sender ---
  b.emit("reaction", { emoji: "👍" });
  await wait(200);

  // --- whiteboard: join, draw, clear, then re-join to confirm history reset ---
  a.emit("whiteboard-join", "board-1");
  await wait(200);
  a.emit("whiteboard-draw", { boardId: "board-1", x0: 0, y0: 0, x1: 10, y1: 10, color: "#ffffff" });
  await wait(200);
  a.emit("whiteboard-clear", "board-1");
  await wait(200);
  a.emit("whiteboard-join", "board-1");
  await wait(200);

  // --- private room isolation: both are at (1,1) from the walk above. Send
  // A into the meeting room and B to just outside its door — still within
  // PROXIMITY_RADIUS (Chebyshev distance 3) but now in different rooms, so
  // the existing call between them must end and nearby chat must not cross. ---
  const toRoomInterior = [
    "down", "down", "down", "down", "down", "down",
    "right", "right", "right", "right", "right", "right", "right", "right", "right", "right", "right", "right", "right",
    "down", "right", "right", "down", "down", "down",
  ];
  const toJustOutsideDoor = [
    "down", "down", "down", "down", "down", "down",
    "right", "right", "right", "right", "right", "right", "right", "right", "right", "right", "right", "right", "right",
    "down", "right", "right",
  ];
  const positions = {};
  a.on("player-moved", (p) => (positions[p.id] = p));
  for (const dir of toRoomInterior) a.emit("move", dir);
  for (const dir of toJustOutsideDoor) b.emit("move", dir);
  await wait(800);
  console.log("positions after room walk:", positions[a.id], positions[b.id]);

  // A (inside the room) sends nearby chat; B (outside, room mismatch) must
  // not receive it even though "socket.emit" would always echo it back to
  // the sender themselves — that's why this checks B's inbox, not A's.
  a.emit("chat-message", { scope: "nearby", text: "should not cross the room wall" });
  await wait(300);

  // --- avatar color: a valid palette color is honored, an invalid one falls
  // back to a random palette color instead of crashing the join ---
  const PLAYER_COLORS = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0x8b5cf6, 0xec4899];
  const carol = io("http://localhost:3001", { transports: ["websocket"] });
  const dave = io("http://localhost:3001", { transports: ["websocket"] });
  let aSawCarolJoin, aSawDaveJoin;
  a.on("player-joined", (player) => {
    if (player.nickname === "Carol") aSawCarolJoin = player;
    if (player.nickname === "Dave") aSawDaveJoin = player;
  });
  carol.on("connect", () => carol.emit("join", { nickname: "Carol", color: 0x3b82f6 }));
  dave.on("connect", () => dave.emit("join", { nickname: "Dave", color: 999999 }));
  await wait(500);

  // --- report: server validates + logs, connection must survive ---
  a.emit("report", { targetId: b.id, reason: "smoke-test" });
  await wait(200);

  // --- minigame (rock-paper-scissors): Carol and Dave both walk onto the
  // same "minigame" object, get matched, and play a round ---
  let carolMatched = false;
  let daveMatched = false;
  let carolResult, daveResult;
  let daveSawOpponentLeft = false;
  carol.on("minigame-matched", () => (carolMatched = true));
  dave.on("minigame-matched", () => (daveMatched = true));
  carol.on("minigame-result", (p) => (carolResult = p));
  dave.on("minigame-result", (p) => (daveResult = p));
  dave.on("minigame-opponent-left", () => (daveSawOpponentLeft = true));

  carol.emit("minigame-join", "rps-1");
  await wait(200);
  dave.emit("minigame-join", "rps-1");
  await wait(200);
  carol.emit("minigame-choice", { choice: "rock" });
  dave.emit("minigame-choice", { choice: "scissors" });
  await wait(300);

  carol.emit("minigame-leave");
  await wait(200);

  // --- admin moderation: an unauthorized client's ban attempt must be a
  // no-op; with ADMIN_TOKEN set (opt-in — most dev/CI runs won't have it),
  // additionally verify a real admin ban force-disconnects the target ---
  let daveAuthResult;
  dave.on("admin-auth-result", (p) => (daveAuthResult = p));
  dave.emit("admin-auth", "definitely-wrong-token");
  await wait(200);
  dave.emit("admin-ban", { targetId: carol.id });
  await wait(300);
  const carolAliveAfterUnauthorizedBan = carol.connected;
  console.log("dave admin-auth-result (wrong token):", daveAuthResult);

  let realAdminBanDisconnectedTarget = true; // vacuously true unless actually tested below
  if (process.env.ADMIN_TOKEN) {
    dave.emit("admin-auth", process.env.ADMIN_TOKEN);
    await wait(200);
    dave.emit("admin-ban", { targetId: carol.id });
    await wait(300);
    realAdminBanDisconnectedTarget = carol.connected === false;
  }

  // --- iceServers shape: STUN always present; a turn: entry is present iff
  // TURN_SECRET/TURN_URLS are configured (see server/.env). Either way this
  // must never be empty, or the client would have no ICE servers at all. ---
  const iceServers = aInit?.iceServers ?? [];
  const hasStun = iceServers.some((s) => String(s.urls).startsWith("stun:"));
  const turnEntry = iceServers.find((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => String(u).startsWith("turn:"))
  );
  console.log("iceServers:", iceServers);

  const results = {
    aInit: Boolean(aInit),
    bSawJoin: Boolean(bSawJoin),
    aSawMove: Boolean(aSawMove),
    bSawOffer: bSawOffer?.offer?.sdp === "test-sdp-offer" && bSawOffer.from === a.id,
    aSawAnswer: aSawAnswer?.answer?.sdp === "test-sdp-answer" && aSawAnswer.from === b.id,
    bSawIceCandidate: bSawIceCandidate?.candidate?.candidate === "test-candidate",
    aSawProximityJoin: aSawProximityJoinOriginal?.peerId === b.id,
    bSawProximityJoin: bSawProximityJoinOriginal?.peerId === a.id,
    aSawGlobalChat: aSawGlobalChat?.text === "hello everyone",
    bSawGlobalChat: bSawGlobalChat?.text === "hello everyone",
    aSawNearbyChat: aSawNearbyChatOriginal?.text === "hey neighbor",
    bSawNearbyChat: bSawNearbyChatOriginal?.text === "hey neighbor",
    aSawReaction: aSawReaction?.emoji === "👍" && aSawReaction.id === b.id,
    bSawReaction: bSawReaction?.emoji === "👍" && bSawReaction.id === b.id,
    whiteboardHistoryShape: Array.isArray(aWhiteboardHistory?.strokes),
    whiteboardDrawRelayed: bSawWhiteboardDraw?.x1 === 10 && bSawWhiteboardDraw.boardId === "board-1",
    whiteboardClearRelayed: aSawWhiteboardClear?.boardId === "board-1",
    whiteboardHistoryResetAfterClear: aWhiteboardHistory?.strokes.length === 0,
    // The room-crossing pair must see a proximity-left even though they're
    // still within Chebyshev range — room mismatch alone must end the call.
    roomIsolationEndedCall: aProximityLeftCount > 0 && bProximityLeftCount > 0,
    roomIsolationBlocksNearbyChat: bSawRoomCrossChat === false,
    avatarColorHonored: aSawCarolJoin?.color === 0x3b82f6,
    avatarColorFallsBackWhenInvalid:
      typeof aSawDaveJoin?.color === "number" && PLAYER_COLORS.includes(aSawDaveJoin.color),
    serverAliveAfterReport: a.connected && b.connected,
    mapObjectsIncludeMinigame: aInit?.map?.objects?.some((o) => o.id === "rps-1" && o.type === "minigame"),
    minigameMatchmakingWorked: carolMatched && daveMatched,
    minigameCarolWon:
      carolResult?.outcome === "win" && carolResult.yourChoice === "rock" && carolResult.opponentChoice === "scissors",
    minigameDaveLost:
      daveResult?.outcome === "lose" && daveResult.yourChoice === "scissors" && daveResult.opponentChoice === "rock",
    minigameOpponentLeftNotified: daveSawOpponentLeft,
    adminBanUnauthorizedIsNoOp: carolAliveAfterUnauthorizedBan,
    adminBanWorksWhenAuthorized: realAdminBanDisconnectedTarget,
    iceServersHasStun: hasStun,
    // Only asserted when TURN is actually configured, so this test also
    // passes on a fresh checkout with no server/.env (STUN-only fallback).
    turnCredentialShape:
      !process.env.TURN_SECRET || (Boolean(turnEntry?.username) && Boolean(turnEntry?.credential)),
  };
  console.log("results:", results);

  carol.close();
  dave.close();

  const ok = Object.values(results).every(Boolean);
  console.log(ok ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED");
  process.exit(ok ? 0 : 1);
}

main();
