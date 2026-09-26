export type Direction = "up" | "down" | "left" | "right";

export interface Player {
  id: string;
  nickname: string;
  color: number;
  x: number;
  y: number;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
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
  type: "whiteboard" | "youtube";
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
  iceServers: IceServerConfig[];
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

// The server never inspects SDP offers/answers or ICE candidates — it only
// relays them between the two peers involved, so their contents are opaque here.
export interface OfferPayload {
  to: string;
  offer: unknown;
}

export interface AnswerPayload {
  to: string;
  answer: unknown;
}

export interface IceCandidatePayload {
  to: string;
  candidate: unknown;
}

// "global" reaches every player in the map; "nearby" reaches only players
// currently within PROXIMITY_RADIUS of the sender (same radius as video calls).
export type ChatScope = "global" | "nearby";

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
