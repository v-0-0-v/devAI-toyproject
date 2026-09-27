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
  type: "whiteboard" | "youtube" | "minigame";
  x: number;
  y: number;
  videoId?: string;
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

export interface MovedPayload {
  id: string;
  x: number;
  y: number;
}

export interface LeftPayload {
  id: string;
}

export interface ProximityJoinedPayload {
  peerId: string;
  nickname: string;
}

export interface ProximityLeftPayload {
  peerId: string;
}

export type ChatScope = "global" | "nearby";

export interface ChatBroadcastPayload {
  id: string;
  nickname: string;
  scope: ChatScope;
  text: string;
  ts: number;
}

export interface ReactionBroadcastPayload {
  id: string;
  emoji: string;
}

export interface WhiteboardStroke {
  boardId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
}

export interface WhiteboardHistoryPayload {
  boardId: string;
  strokes: WhiteboardStroke[];
}

export interface WhiteboardClearPayload {
  boardId: string;
}

export type RpsChoice = "rock" | "paper" | "scissors";

export interface MinigameWaitingPayload {
  objectId: string;
}

export interface MinigameMatchedPayload {
  objectId: string;
}

export interface MinigameResultPayload {
  yourChoice: RpsChoice;
  opponentChoice: RpsChoice;
  outcome: "win" | "lose" | "draw";
}

export interface AdminAuthResultPayload {
  ok: boolean;
}

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

// --- mediasoup SFU signaling ------------------------------------------
// Mirrors server/src/types.ts's SFU payload shapes. RTP-shaped fields are
// opaque here (`unknown`) — webrtc.ts casts them to mediasoup-client's real
// types right where it hands them to the Device/Transport APIs.
export type SfuMediaKind = "audio" | "video";

export interface SfuTransportOptions {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown;
  dtlsParameters: unknown;
}

export interface SfuConsumerOptions {
  id: string;
  producerId: string;
  peerId: string;
  kind: SfuMediaKind;
  rtpParameters: unknown;
}

export interface SfuConsumePeerResult {
  consumers: SfuConsumerOptions[];
}

export interface SfuNewProducerPayload {
  peerId: string;
  producerId: string;
  kind: SfuMediaKind;
}
