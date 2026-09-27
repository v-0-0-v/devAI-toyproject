import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdminReportEntry, WhiteboardStroke } from "./types.js";

// A durable log the in-memory/Redis GameStore doesn't provide on its own:
// whiteboard strokes and moderation reports survive a server restart (and,
// with Redis, survive a Redis restart too, since this lives in a separate
// local file). In a horizontally-scaled deployment this is per-instance —
// each process only persists the strokes/reports it happened to handle — a
// real production setup would point this at a shared DB instead of a local
// SQLite file. Acceptable for a mini MVP; see README.
const DEFAULT_DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "zep.db");
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS whiteboard_strokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id TEXT NOT NULL,
    x0 REAL NOT NULL,
    y0 REAL NOT NULL,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_whiteboard_strokes_board ON whiteboard_strokes(board_id);

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id TEXT NOT NULL,
    reporter_nickname TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_nickname TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const insertStrokeStmt = db.prepare(
  "INSERT INTO whiteboard_strokes (board_id, x0, y0, x1, y1, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const selectStrokesStmt = db.prepare(
  "SELECT x0, y0, x1, y1, color FROM whiteboard_strokes WHERE board_id = ? ORDER BY id ASC LIMIT ?"
);
const deleteStrokesStmt = db.prepare("DELETE FROM whiteboard_strokes WHERE board_id = ?");
const insertReportStmt = db.prepare(
  "INSERT INTO reports (reporter_id, reporter_nickname, target_id, target_nickname, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const selectReportsStmt = db.prepare("SELECT * FROM reports ORDER BY id DESC LIMIT ?");

export function appendWhiteboardStroke(stroke: WhiteboardStroke): void {
  insertStrokeStmt.run(stroke.boardId, stroke.x0, stroke.y0, stroke.x1, stroke.y1, stroke.color, Date.now());
}

export function getWhiteboardStrokes(boardId: string, limit: number): WhiteboardStroke[] {
  const rows = selectStrokesStmt.all(boardId, limit) as Array<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    color: string;
  }>;
  return rows.map((row) => ({ boardId, x0: row.x0, y0: row.y0, x1: row.x1, y1: row.y1, color: row.color }));
}

export function clearWhiteboardStrokes(boardId: string): void {
  deleteStrokesStmt.run(boardId);
}

export function insertReport(entry: {
  reporterId: string;
  reporterNickname: string;
  targetId: string;
  targetNickname: string;
  reason: string;
}): void {
  insertReportStmt.run(
    entry.reporterId,
    entry.reporterNickname,
    entry.targetId,
    entry.targetNickname,
    entry.reason,
    Date.now()
  );
}

export function listRecentReports(limit: number): AdminReportEntry[] {
  const rows = selectReportsStmt.all(limit) as Array<{
    id: number;
    reporter_id: string;
    reporter_nickname: string;
    target_id: string;
    target_nickname: string;
    reason: string;
    created_at: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    reporterId: row.reporter_id,
    reporterNickname: row.reporter_nickname,
    targetId: row.target_id,
    targetNickname: row.target_nickname,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
