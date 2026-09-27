export type Direction = "up" | "down" | "left" | "right";

export interface Player {
  id: string;
  nickname: string;
  color: number;
  x: number;
  y: number;
}

export interface RoomZone {
  id: number;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MapObject {
  id: string;
  type: "whiteboard" | "youtube" | "minigame" | "script";
  x: number;
  y: number;
  videoId?: string;
  /** ZEP Script source (see server/src/zepScript.ts) — only meaningful when type is "script". */
  code?: string;
}

export interface InitPayload {
  selfId: string;
  players: Record<string, Player>;
  map: {
    width: number;
    height: number;
    tileSize: number;
    walls: number[][];
    rooms: RoomZone[];
    objects: MapObject[];
  };
}

// Sent by the client on "join". `color` is a client-picked value from the
// same PLAYER_COLORS palette the server validates against — a bare string is
// also accepted for backwards compatibility (nickname-only join).
export interface JoinPayload {
  nickname: string;
  color?: number;
}

export interface ProximityJoinedPayload {
  peerId: string;
  nickname: string;
}

export interface ProximityLeftPayload {
  peerId: string;
}

// --- mediasoup SFU signaling ------------------------------------------
// Replaces the old per-pair P2P offer/answer/ICE relay (see sfu.ts's doc
// comment for why). RTP-shaped fields (rtpCapabilities/rtpParameters/
// dtlsParameters/ice*) are opaque here — the server passes them straight
// into mediasoup's own APIs, and types.ts's job is just the wire shape.
export type SfuMediaKind = "audio" | "video";

export interface SfuCreateTransportPayload {
  direction: "send" | "recv";
}

export interface SfuTransportOptions {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
}

export interface SfuConnectTransportPayload {
  transportId: string;
  dtlsParameters: unknown;
}

export interface SfuProducePayload {
  transportId: string;
  kind: SfuMediaKind;
  rtpParameters: unknown;
}

export interface SfuProduceResult {
  id: string;
}

export interface SfuConsumePayload {
  producerId: string;
}

export interface SfuConsumerOptions {
  id: string;
  producerId: string;
  peerId: string;
  kind: SfuMediaKind;
  rtpParameters: unknown;
}

export interface SfuConsumePeerPayload {
  peerId: string;
}

export interface SfuConsumePeerResult {
  consumers: SfuConsumerOptions[];
}

export interface SfuResumeConsumerPayload {
  consumerId: string;
}

export interface SfuCloseConsumersForPeerPayload {
  peerId: string;
}

// Pushed to a peer's existing call-partners when they start a new producer
// after the call was already established (e.g. their camera finished
// initializing a moment after proximity-joined already fired).
export interface SfuNewProducerPayload {
  peerId: string;
  producerId: string;
  kind: SfuMediaKind;
}

// "global" reaches every player in the map; "nearby" reaches only players
// currently within PROXIMITY_RADIUS of the sender (same radius as video
// calls). "system" is server-only — a ZEP Script's $.say/$.broadcast (see
// zepScript.ts) — the chat-message handler's own allow-list already rejects
// it from a client, so no separate check is needed to keep a client from
// impersonating the system.
export type ChatScope = "global" | "nearby" | "system";

export interface ChatMessagePayload {
  scope: ChatScope;
  text: string;
}

export interface ChatBroadcastPayload {
  id: string;
  nickname: string;
  scope: ChatScope;
  text: string;
  ts: number;
}

export interface ReactionPayload {
  emoji: string;
}

export interface ReactionBroadcastPayload {
  id: string;
  emoji: string;
}

// Whiteboard strokes are relayed opaquely (like WebRTC signaling) except for
// `boardId`, which the server uses to key per-board history.
export interface WhiteboardStroke {
  boardId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
}

export interface ReportPayload {
  targetId: string;
  reason?: string;
}

export type RpsChoice = "rock" | "paper" | "scissors";

export interface MinigameWaitingPayload {
  objectId: string;
}

export interface MinigameMatchedPayload {
  objectId: string;
}

export interface MinigameChoicePayload {
  choice: RpsChoice;
}

export interface MinigameResultPayload {
  yourChoice: RpsChoice;
  opponentChoice: RpsChoice;
  outcome: "win" | "lose" | "draw";
}

export interface AdminAuthResultPayload {
  ok: boolean;
}

export interface AdminBanPayload {
  targetId: string;
}

// Persisted (SQLite) copy of a report — unlike the moderation report handler
// itself, this survives server restarts and is readable by an admin.
export interface AdminReportEntry {
  id: number;
  reporterId: string;
  reporterNickname: string;
  targetId: string;
  targetNickname: string;
  reason: string;
  createdAt: number;
}

export interface AdminReportsPayload {
  reports: AdminReportEntry[];
}

export interface MapDataPayload {
  width: number;
  height: number;
  tileSize: number;
  proximityRadius: number;
  walls: number[][];
  rooms: RoomZone[];
  objects: MapObject[];
}
