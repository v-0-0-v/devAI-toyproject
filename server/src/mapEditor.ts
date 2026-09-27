import fs from "node:fs";
import express, { type Express } from "express";
import { MAP_DATA_PATH } from "./map.js";
import { MAX_SCRIPT_CODE_LENGTH } from "./zepScript.js";
import type { MapDataPayload, MapObject, RoomZone } from "./types.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Rejects anything that could corrupt the map file or make map.ts's
// isWalkable/roomIdAt misbehave at runtime — this is the only gate between
// the editor UI and a file every server restart reads back in.
function validateMapData(input: unknown): MapDataPayload | string {
  if (!isPlainObject(input)) return "요청 본문이 객체가 아닙니다";

  for (const key of ["width", "height", "tileSize", "proximityRadius"] as const) {
    const v = input[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return `${key} 값이 올바르지 않습니다`;
  }
  const width = input.width as number;
  const height = input.height as number;

  if (!Array.isArray(input.walls) || input.walls.length !== height) {
    return `walls는 ${height}개 행이어야 합니다`;
  }
  for (const row of input.walls as unknown[]) {
    if (!Array.isArray(row) || row.length !== width || row.some((c) => c !== 0 && c !== 1)) {
      return `walls의 각 행은 ${width}개의 0/1 값이어야 합니다`;
    }
  }

  if (!Array.isArray(input.rooms)) return "rooms가 배열이 아닙니다";
  const rooms: RoomZone[] = [];
  for (const raw of input.rooms as unknown[]) {
    if (!isPlainObject(raw)) return "rooms 항목이 올바르지 않습니다";
    const { id, label, x0, y0, x1, y1 } = raw;
    if (
      typeof id !== "number" ||
      typeof label !== "string" ||
      typeof x0 !== "number" ||
      typeof y0 !== "number" ||
      typeof x1 !== "number" ||
      typeof y1 !== "number"
    ) {
      return "rooms 항목의 필드가 올바르지 않습니다";
    }
    if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height || x0 > x1 || y0 > y1) {
      return `room "${label}"의 좌표가 맵 범위를 벗어났습니다`;
    }
    rooms.push({ id, label, x0, y0, x1, y1 });
  }

  if (!Array.isArray(input.objects)) return "objects가 배열이 아닙니다";
  const VALID_TYPES = new Set(["whiteboard", "youtube", "minigame", "script"]);
  const objects: MapObject[] = [];
  const seenIds = new Set<string>();
  for (const raw of input.objects as unknown[]) {
    if (!isPlainObject(raw)) return "objects 항목이 올바르지 않습니다";
    const { id, type, x, y, videoId, code } = raw;
    if (typeof id !== "string" || id.length === 0) return "object id가 올바르지 않습니다";
    if (seenIds.has(id)) return `object id가 중복됩니다: ${id}`;
    seenIds.add(id);
    if (typeof type !== "string" || !VALID_TYPES.has(type)) return `object "${id}"의 type이 올바르지 않습니다`;
    if (typeof x !== "number" || typeof y !== "number" || x < 0 || y < 0 || x >= width || y >= height) {
      return `object "${id}"의 좌표가 맵 범위를 벗어났습니다`;
    }
    if (type === "youtube" && typeof videoId !== "string") {
      return `object "${id}"(youtube)에는 videoId가 필요합니다`;
    }
    if (type === "script") {
      if (typeof code !== "string" || code.trim().length === 0) {
        return `object "${id}"(script)에는 code가 필요합니다`;
      }
      if (code.length > MAX_SCRIPT_CODE_LENGTH) {
        return `object "${id}"(script)의 code가 너무 깁니다 (최대 ${MAX_SCRIPT_CODE_LENGTH}자)`;
      }
    }
    const obj: MapObject = { id, type: type as MapObject["type"], x, y };
    if (typeof videoId === "string") obj.videoId = videoId;
    if (typeof code === "string") obj.code = code;
    objects.push(obj);
  }

  return {
    width,
    height,
    tileSize: input.tileSize as number,
    proximityRadius: input.proximityRadius as number,
    walls: input.walls as number[][],
    rooms,
    objects,
  };
}

// GET is unauthenticated: every joined player already receives an equivalent
// (slightly smaller) view of this same data via the "init" socket payload,
// so serving it over REST too exposes nothing new. Only saving requires the
// admin token, same gate as admin-ban/admin-list-reports.
export function registerMapEditorRoutes(app: Express, adminToken: string | undefined): void {
  app.get("/api/map", (_req, res) => {
    try {
      const raw = fs.readFileSync(MAP_DATA_PATH, "utf8");
      res.type("application/json").send(raw);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/api/map", express.json({ limit: "1mb" }), (req, res) => {
    if (!adminToken) {
      res.status(503).json({ ok: false, error: "서버에 ADMIN_TOKEN이 설정되어 있지 않습니다" });
      return;
    }
    if (req.header("x-admin-token") !== adminToken) {
      res.status(403).json({ ok: false, error: "관리자 토큰이 올바르지 않습니다" });
      return;
    }

    const result = validateMapData(req.body);
    if (typeof result === "string") {
      res.status(400).json({ ok: false, error: result });
      return;
    }

    try {
      if (fs.existsSync(MAP_DATA_PATH)) fs.copyFileSync(MAP_DATA_PATH, `${MAP_DATA_PATH}.bak`);
      fs.writeFileSync(MAP_DATA_PATH, JSON.stringify(result, null, 2));
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
      return;
    }

    // map.ts reads MAP_DATA_PATH once at module load, so this can't take
    // effect on the running process — hot-swapping live game state (players
    // already standing where a wall now is, etc.) is out of scope here.
    res.json({ ok: true, restartRequired: true });
  });
}
