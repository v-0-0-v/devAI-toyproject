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
