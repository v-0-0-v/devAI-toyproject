import * as mediasoup from "mediasoup";
import type { Router, Worker, WebRtcTransport, RouterRtpCodecCapability } from "mediasoup/types";

// Replaces the old per-pair P2P mesh (one RTCPeerConnection per nearby
// player, see the removed webrtc-offer/answer/ice-candidate relay) with a
// Selective Forwarding Unit: every client sends its camera/mic to the server
// exactly once (a Producer), and the server forwards it to whichever other
// clients currently need it (a Consumer each) — bandwidth for an N-person
// cluster scales with N, not N², and NAT traversal is no longer a P2P
// problem since the server is always one side of every connection (this is
// also why TURN/coturn is no longer wired into the live call path — see
// README).
//
// One Worker + one Router for the whole process: this app has no concept of
// separate "rooms" (the whole map is one shared space, proximity is dynamic),
// so a single router serving every peer is the right granularity. Per-socket
// transport/producer/consumer state (see index.ts's `sfuPeers`) is kept
// in-memory only, same accepted limitation as the RPS minigame (server/src/
// index.ts's minigameWaiting comment) — it is NOT part of GameStore, so in a
// horizontally-scaled (Redis) deployment, media only flows between peers
// whose sockets land on the same instance.
const MEDIA_CODECS: RouterRtpCodecCapability[] = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
];

let worker: Worker;
let router: Router;

export async function initMediasoup(): Promise<Router> {
  const minPort = Number(process.env.MEDIASOUP_MIN_PORT ?? 40000);
  const maxPort = Number(process.env.MEDIASOUP_MAX_PORT ?? 40100);

  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: minPort,
    rtcMaxPort: maxPort,
  });
  worker.on("died", () => {
    console.error("[sfu] mediasoup worker died unexpectedly, exiting");
    process.exit(1);
  });

  router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  console.log(`[sfu] mediasoup worker (pid ${worker.pid}) + router ready (RTP ports ${minPort}-${maxPort})`);
  return router;
}

export function getRouter(): Router {
  return router;
}

// The client and server must agree on the same host/announced IP story as
// coturn did: MEDIASOUP_ANNOUNCED_IP is the server's public IP in production
// (set in server/.env.production). Unlike coturn, mediasoup does NOT resolve
// "0.0.0.0" into real interface addresses on its own — when announcedIp is
// unset, whatever `ip` is set to is advertised to clients *verbatim* as the
// ICE candidate address. "0.0.0.0" is not a usable candidate address (every
// candidate pair fails silently, connectionState stays "new" forever), so
// the dev default here is the concrete loopback address instead — correct
// for same-machine testing, but MEDIASOUP_LISTEN_IP/MEDIASOUP_ANNOUNCED_IP
// must be set for anything beyond that (LAN, Docker, production).
export async function createWebRtcTransport(): Promise<WebRtcTransport> {
  const listenIp = process.env.MEDIASOUP_LISTEN_IP ?? "127.0.0.1";
  const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP;

  return router.createWebRtcTransport({
    listenIps: [{ ip: listenIp, announcedIp }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
}
