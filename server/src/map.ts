import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Fixed interactive objects players can walk onto (see server/src/index.ts's
// whiteboard-*/minigame-* relays and client/src/objectInteraction.ts +
// client/src/minigame.ts).
export interface MapObject {
  id: string;
  type: "whiteboard" | "youtube" | "minigame";
  x: number;
  y: number;
  videoId?: string;
}

interface MapData {
  width: number;
  height: number;
  tileSize: number;
  proximityRadius: number;
  walls: number[][];
  rooms: RoomZone[];
  objects: MapObject[];
}

// Map layout lives in a plain JSON file instead of hardcoded TS so it can be
// edited (or swapped out via MAP_DATA_PATH, e.g. a mounted volume in
// production) without touching code — either directly, or via the web-based
// editor (client/editor.html, saved through index.ts's /api/map).
const DEFAULT_MAP_DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "mapdata.json");
// Exported so index.ts's /api/map save endpoint writes to the exact same
// file this module read from at startup (MAP_DATA_PATH override included).
// A save always requires a server restart to take effect — see README.
export const MAP_DATA_PATH = process.env.MAP_DATA_PATH ?? DEFAULT_MAP_DATA_PATH;

const mapData: MapData = JSON.parse(fs.readFileSync(MAP_DATA_PATH, "utf8"));

export const MAP_WIDTH = mapData.width;
export const MAP_HEIGHT = mapData.height;
export const TILE_SIZE = mapData.tileSize;
export const PROXIMITY_RADIUS = mapData.proximityRadius;
export const WALLS = mapData.walls;
export const ROOMS = mapData.rooms;
export const OBJECTS = mapData.objects;

export function roomIdAt(x: number, y: number): number {
  for (const room of ROOMS) {
    if (x >= room.x0 && x <= room.x1 && y >= room.y0 && y <= room.y1) return room.id;
  }
  return 0;
}

export function isWalkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
  return WALLS[y][x] === 0;
}

// Never spawns inside a private room: a freshly-joined player should land
// in the open area, not inside someone else's in-progress meeting.
export function randomSpawnPoint(): { x: number; y: number } {
  while (true) {
    const x = Math.floor(Math.random() * MAP_WIDTH);
    const y = Math.floor(Math.random() * MAP_HEIGHT);
    if (isWalkable(x, y) && roomIdAt(x, y) === 0) return { x, y };
  }
}
