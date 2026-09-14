import { io } from "socket.io-client";

const a = io("http://localhost:3001", { transports: ["websocket"] });
const b = io("http://localhost:3001", { transports: ["websocket"] });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let aInit, bSawJoin, aSawMove;
let bSawOffer, aSawAnswer, bSawIceCandidate;
let aSawProximityJoin, bSawProximityJoin;

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

  const results = {
    aInit: Boolean(aInit),
    bSawJoin: Boolean(bSawJoin),
    aSawMove: Boolean(aSawMove),
    bSawOffer: bSawOffer?.offer?.sdp === "test-sdp-offer" && bSawOffer.from === a.id,
    aSawAnswer: aSawAnswer?.answer?.sdp === "test-sdp-answer" && aSawAnswer.from === b.id,
    bSawIceCandidate: bSawIceCandidate?.candidate?.candidate === "test-candidate",
    aSawProximityJoin: aSawProximityJoin?.peerId === b.id,
    bSawProximityJoin: bSawProximityJoin?.peerId === a.id,
  };
  console.log("results:", results);

  const ok = Object.values(results).every(Boolean);
  console.log(ok ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED");
  process.exit(ok ? 0 : 1);
}

main();
