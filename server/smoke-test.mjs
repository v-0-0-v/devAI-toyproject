import { io } from "socket.io-client";

const a = io("http://localhost:3001", { transports: ["websocket"] });
const b = io("http://localhost:3001", { transports: ["websocket"] });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let aInit, bSawJoin, aSawMove;

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
  console.log("A saw player-moved:", payload);
});

a.on("connect", () => a.emit("join", "Alice"));

async function main() {
  await wait(500);
  b.emit("join", "Bob");
  await wait(500);

  // Alice tries to move; server validates against wall collision and broadcasts.
  a.emit("move", "up");
  a.emit("move", "down");
  a.emit("move", "left");
  a.emit("move", "right");
  await wait(500);

  const ok = Boolean(aInit) && Boolean(bSawJoin) && Boolean(aSawMove);
  console.log(ok ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED");
  process.exit(ok ? 0 : 1);
}

main();
