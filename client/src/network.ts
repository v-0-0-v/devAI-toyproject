import { io, Socket } from "socket.io-client";
import type {
  ChatBroadcastPayload,
  ChatScope,
  Direction,
  InitPayload,
  LeftPayload,
  MovedPayload,
  Player,
  ProximityJoinedPayload,
  ProximityLeftPayload,
  ReactionBroadcastPayload,
  RelayedAnswerPayload,
  RelayedIceCandidatePayload,
  RelayedOfferPayload,
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
  "webrtc-offer": RelayedOfferPayload;
  "webrtc-answer": RelayedAnswerPayload;
  "webrtc-ice-candidate": RelayedIceCandidatePayload;
  "chat-message": ChatBroadcastPayload;
  reaction: ReactionBroadcastPayload;
}

type Listener<T> = (payload: T) => void;

const EVENT_NAMES = [
  "init",
  "player-joined",
  "player-moved",
  "player-left",
  "proximity-joined",
  "proximity-left",
  "webrtc-offer",
  "webrtc-answer",
  "webrtc-ice-candidate",
  "chat-message",
  "reaction",
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
    "webrtc-offer": new Set(),
    "webrtc-answer": new Set(),
    "webrtc-ice-candidate": new Set(),
    "chat-message": new Set(),
    reaction: new Set(),
  };

  constructor(nickname: string) {
    this.socket = io(SERVER_URL, { transports: ["websocket"] });

    this.socket.on("connect", () => {
      this.socket.emit("join", nickname);
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

  sendOffer(to: string, offer: RTCSessionDescriptionInit) {
    this.socket.emit("webrtc-offer", { to, offer });
  }

  sendAnswer(to: string, answer: RTCSessionDescriptionInit) {
    this.socket.emit("webrtc-answer", { to, answer });
  }

  sendIceCandidate(to: string, candidate: RTCIceCandidateInit) {
    this.socket.emit("webrtc-ice-candidate", { to, candidate });
  }

  sendChatMessage(scope: ChatScope, text: string) {
    this.socket.emit("chat-message", { scope, text });
  }

  sendReaction(emoji: string) {
    this.socket.emit("reaction", { emoji });
  }
}
