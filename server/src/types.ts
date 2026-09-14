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
