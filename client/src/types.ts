export type Direction = "up" | "down" | "left" | "right";

export interface Player {
  id: string;
  nickname: string;
  color: number;
  x: number;
  y: number;
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
  iceServers: RTCIceServer[];
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

export interface RelayedOfferPayload {
  from: string;
  offer: RTCSessionDescriptionInit;
}

export interface RelayedAnswerPayload {
  from: string;
  answer: RTCSessionDescriptionInit;
}

export interface RelayedIceCandidatePayload {
  from: string;
  candidate: RTCIceCandidateInit;
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
