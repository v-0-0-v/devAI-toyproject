export const TILE_SIZE = 32;
export const MAP_WIDTH = 20;
export const MAP_HEIGHT = 15;

// Chebyshev-distance (tile "square") radius within which two players are
// considered close enough to start a video call, mirroring ZEP/Gather.town's
// proximity chat.
export const PROXIMITY_RADIUS = 3;

// An enclosed "private room" (mirrors ZEP/Gather's soundproof meeting rooms):
// players inside it never hear/see-call players outside it, even if within
// PROXIMITY_RADIUS across the wall (see roomIdAt() + server/src/index.ts's
// isNear()). Bounds are the walkable interior, inclusive.
export interface RoomZone {
  id: number;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const ROOMS: RoomZone[] = [{ id: 1, label: "회의실", x0: 15, y0: 10, x1: 17, y1: 12 }];

export function roomIdAt(x: number, y: number): number {
  for (const room of ROOMS) {
    if (x >= room.x0 && x <= room.x1 && y >= room.y0 && y <= room.y1) return room.id;
  }
  return 0;
}

// Fixed interactive objects players can walk onto (see server/src/index.ts's
// whiteboard-* relay and client/src/objectInteraction.ts).
export interface MapObject {
  id: string;
  type: "whiteboard" | "youtube";
  x: number;
  y: number;
  videoId?: string;
}

export const OBJECTS: MapObject[] = [
  // Inside the meeting room, so board sessions stay scoped to who's actually in there.
  { id: "board-1", type: "whiteboard", x: 16, y: 11 },
  { id: "tv-1", type: "youtube", x: 9, y: 3, videoId: "dQw4w9WgXcQ" },
];

// 0 = floor (walkable), 1 = wall (blocked)
// Border walls + a couple of inner obstacles, roughly resembling a small office layout.
export const WALLS: number[][] = (() => {
  const grid: number[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array<number>(MAP_WIDTH).fill(0)
  );

  for (let x = 0; x < MAP_WIDTH; x++) {
    grid[0][x] = 1;
    grid[MAP_HEIGHT - 1][x] = 1;
  }
  for (let y = 0; y < MAP_HEIGHT; y++) {
    grid[y][0] = 1;
    grid[y][MAP_WIDTH - 1] = 1;
  }

  // A couple of inner "desks" as obstacles.
  const desks = [
    [4, 3], [4, 4], [5, 3], [5, 4],
    [12, 8], [13, 8], [12, 9], [13, 9],
    [8, 6], [9, 6],
  ];
  for (const [x, y] of desks) {
    grid[y][x] = 1;
  }

  // Wall off each room's perimeter, leaving a single door tile open at the
  // middle of the top wall (not the bottom wall — this map's bottom border
  // wall runs right along y = MAP_HEIGHT - 2, leaving no open tile to
  // approach a bottom door from outside).
  for (const room of ROOMS) {
    for (let x = room.x0 - 1; x <= room.x1 + 1; x++) {
      grid[room.y0 - 1][x] = 1;
      grid[room.y1 + 1][x] = 1;
    }
    for (let y = room.y0 - 1; y <= room.y1 + 1; y++) {
      grid[y][room.x0 - 1] = 1;
      grid[y][room.x1 + 1] = 1;
    }
    const doorX = Math.floor((room.x0 + room.x1) / 2);
    grid[room.y0 - 1][doorX] = 0;
  }

  return grid;
})();

export function isWalkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
  return WALLS[y][x] === 0;
}

export function randomSpawnPoint(): { x: number; y: number } {
  while (true) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    if (isWalkable(x, y)) return { x, y };
  }
}
