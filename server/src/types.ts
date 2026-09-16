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

export interface InitPayload {
  selfId: string;
  players: Record<string, Player>;
  map: {
    width: number;
    height: number;
    tileSize: number;
    walls: number[][];
  };
  iceServers: IceServerConfig[];
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
