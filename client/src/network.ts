import { io, Socket } from "socket.io-client";
import type {
  AdminAuthResultPayload,
  AdminReportsPayload,
  ChatBroadcastPayload,
  ChatScope,
  Direction,
  InitPayload,
  LeftPayload,
  MinigameMatchedPayload,
  MinigameResultPayload,
  MinigameWaitingPayload,
  MovedPayload,
  Player,
  ProximityJoinedPayload,
  ProximityLeftPayload,
  ReactionBroadcastPayload,
  RpsChoice,
  SfuConsumePeerResult,
  SfuConsumerOptions,
  SfuMediaKind,
  SfuNewProducerPayload,
  SfuTransportOptions,
  WhiteboardClearPayload,
  WhiteboardHistoryPayload,
  WhiteboardStroke,
} from "./types";

// If VITE_SERVER_URL isn't set: in dev, default to the local server on a
// different port; in a production build, connect same-origin (the server is
// expected to be reverse-proxied under the same domain as the static site —
// see deploy/Caddyfile) by passing `undefined` to socket.io-client, which it
// treats as "use the page's own origin".
const SERVER_URL: string | undefined =
  import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);

interface ServerEvents {
  init: InitPayload;
  "player-joined": Player;
  "player-moved": MovedPayload;
  "player-left": LeftPayload;
  "proximity-joined": ProximityJoinedPayload;
  "proximity-left": ProximityLeftPayload;
  "sfu-new-producer": SfuNewProducerPayload;
  "chat-message": ChatBroadcastPayload;
  reaction: ReactionBroadcastPayload;
  "whiteboard-draw": WhiteboardStroke;
  "whiteboard-history": WhiteboardHistoryPayload;
  "whiteboard-clear": WhiteboardClearPayload;
  "minigame-waiting": MinigameWaitingPayload;
  "minigame-matched": MinigameMatchedPayload;
  "minigame-result": MinigameResultPayload;
  "minigame-opponent-left": undefined;
  "admin-auth-result": AdminAuthResultPayload;
  "admin-banned": undefined;
  "admin-reports": AdminReportsPayload;
}

type Listener<T> = (payload: T) => void;

const EVENT_NAMES = [
  "init",
  "player-joined",
  "player-moved",
  "player-left",
  "proximity-joined",
  "proximity-left",
  "sfu-new-producer",
  "chat-message",
  "reaction",
  "whiteboard-draw",
  "whiteboard-history",
  "whiteboard-clear",
  "minigame-waiting",
  "minigame-matched",
  "minigame-result",
  "minigame-opponent-left",
  "admin-auth-result",
  "admin-banned",
  "admin-reports",
] as const satisfies readonly (keyof ServerEvents)[];

/**
 * Thin wrapper around a single Socket.IO connection that lets multiple,
 * independent consumers (the game scene, the video chat manager, ...)
 * subscribe to the same server events without stepping on each other.
 */
export class Network {
  private socket: Socket;
  private listeners: { [K in keyof ServerEvents]: Set<Listener<ServerEvents[K]>> } = {
    init: new Set(),
    "player-joined": new Set(),
    "player-moved": new Set(),
    "player-left": new Set(),
    "proximity-joined": new Set(),
    "proximity-left": new Set(),
    "sfu-new-producer": new Set(),
    "chat-message": new Set(),
    reaction: new Set(),
    "whiteboard-draw": new Set(),
    "whiteboard-history": new Set(),
    "whiteboard-clear": new Set(),
    "minigame-waiting": new Set(),
    "minigame-matched": new Set(),
    "minigame-result": new Set(),
    "minigame-opponent-left": new Set(),
    "admin-auth-result": new Set(),
    "admin-banned": new Set(),
    "admin-reports": new Set(),
  };

  constructor(nickname: string, color?: number) {
    this.socket = io(SERVER_URL, { transports: ["websocket"] });

    this.socket.on("connect", () => {
      this.socket.emit("join", { nickname, color });
    });

    // Cast to `unknown` here: dispatching by a runtime event name can't stay
    // narrowed per-iteration in TS, but each concrete listener is still fully
    // typed via the `on<K>` method below.
    for (const event of EVENT_NAMES) {
      this.socket.on(event, ((payload: unknown) => {
        for (const listener of this.listeners[event]) {
          (listener as (payload: unknown) => void)(payload);
        }
      }) as (...args: unknown[]) => void);
    }
  }

  on<K extends keyof ServerEvents>(event: K, listener: Listener<ServerEvents[K]>): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  move(direction: Direction) {
    this.socket.emit("move", direction);
  }

  // --- mediasoup SFU signaling (see webrtc.ts) ---------------------------
  // Request/response shaped, so these use Socket.IO's ack-based
  // emitWithAck() instead of the fire-and-forget pattern used elsewhere.
  sfuGetRouterRtpCapabilities(): Promise<unknown> {
    return this.socket.emitWithAck("sfu-get-rtp-capabilities", null);
  }

  sfuSetRtpCapabilities(rtpCapabilities: unknown): Promise<{ ok: boolean }> {
    return this.socket.emitWithAck("sfu-set-rtp-capabilities", rtpCapabilities);
  }

  sfuCreateTransport(direction: "send" | "recv"): Promise<SfuTransportOptions | null> {
    return this.socket.emitWithAck("sfu-create-transport", { direction });
  }

  sfuConnectTransport(transportId: string, dtlsParameters: unknown): Promise<{ ok: boolean }> {
    return this.socket.emitWithAck("sfu-connect-transport", { transportId, dtlsParameters });
  }

  sfuProduce(transportId: string, kind: SfuMediaKind, rtpParameters: unknown): Promise<{ id: string } | null> {
    return this.socket.emitWithAck("sfu-produce", { transportId, kind, rtpParameters });
  }

  sfuConsume(producerId: string): Promise<SfuConsumerOptions | null> {
    return this.socket.emitWithAck("sfu-consume", { producerId });
  }

  sfuConsumePeer(peerId: string): Promise<SfuConsumePeerResult> {
    return this.socket.emitWithAck("sfu-consume-peer", { peerId });
  }

  sfuResumeConsumer(consumerId: string): Promise<{ ok: boolean }> {
    return this.socket.emitWithAck("sfu-resume-consumer", { consumerId });
  }

  sfuCloseConsumersForPeer(peerId: string): Promise<{ ok: boolean }> {
    return this.socket.emitWithAck("sfu-close-consumers-for-peer", { peerId });
  }

  sendChatMessage(scope: ChatScope, text: string) {
    this.socket.emit("chat-message", { scope, text });
  }

  sendReaction(emoji: string) {
    this.socket.emit("reaction", { emoji });
  }

  joinWhiteboard(boardId: string) {
    this.socket.emit("whiteboard-join", boardId);
  }

  sendWhiteboardStroke(stroke: WhiteboardStroke) {
    this.socket.emit("whiteboard-draw", stroke);
  }

  clearWhiteboard(boardId: string) {
    this.socket.emit("whiteboard-clear", boardId);
  }

  sendReport(targetId: string, reason?: string) {
    this.socket.emit("report", { targetId, reason });
  }

  joinMinigame(objectId: string) {
    this.socket.emit("minigame-join", objectId);
  }

  sendMinigameChoice(choice: RpsChoice) {
    this.socket.emit("minigame-choice", { choice });
  }

  leaveMinigame() {
    this.socket.emit("minigame-leave");
  }

  sendAdminAuth(token: string) {
    this.socket.emit("admin-auth", token);
  }

  sendAdminBan(targetId: string) {
    this.socket.emit("admin-ban", { targetId });
  }

  requestAdminReports() {
    this.socket.emit("admin-list-reports");
  }
}
