// Standalone page (editor.html) — not part of the game bundle. Loads/saves
// the same mapdata.json the server reads at startup (see server/src/map.ts +
// server/src/mapEditor.ts's /api/map). A save always requires a server
// restart to take effect; this editor never touches a live game session.
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? "http://localhost:3001" : "");

type MapObjectType = "whiteboard" | "youtube" | "minigame" | "script";

interface RoomZone {
  id: number;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface MapObjectData {
  id: string;
  type: MapObjectType;
  x: number;
  y: number;
  videoId?: string;
  code?: string;
}

interface MapData {
  width: number;
  height: number;
  tileSize: number;
  proximityRadius: number;
  walls: number[][];
  rooms: RoomZone[];
  objects: MapObjectData[];
}

const CELL_PX = 28;

let mapData: MapData | null = null;
let mode: "wall" | "room" | "object" = "wall";
let roomFirstCorner: { x: number; y: number } | null = null;
let dragging = false;
let paintValue = 0;
let lastPaintedCell = "";

const tokenInput = document.querySelector<HTMLInputElement>("#admin-token")!;
const loadBtn = document.querySelector<HTMLButtonElement>("#load-btn")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save-btn")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;

const dimWidth = document.querySelector<HTMLInputElement>("#dim-width")!;
const dimHeight = document.querySelector<HTMLInputElement>("#dim-height")!;
const dimTileSize = document.querySelector<HTMLInputElement>("#dim-tile-size")!;
const dimProximity = document.querySelector<HTMLInputElement>("#dim-proximity")!;
const resizeBtn = document.querySelector<HTMLButtonElement>("#resize-btn")!;

const modeButtons = document.querySelectorAll<HTMLButtonElement>("#mode-buttons button");
const canvas = document.querySelector<HTMLCanvasElement>("#map-canvas")!;
const ctx = canvas.getContext("2d")!;

const roomListEl = document.querySelector<HTMLDivElement>("#room-list")!;
const roomIdInput = document.querySelector<HTMLInputElement>("#room-id")!;
const roomLabelInput = document.querySelector<HTMLInputElement>("#room-label")!;
const roomX0 = document.querySelector<HTMLInputElement>("#room-x0")!;
const roomY0 = document.querySelector<HTMLInputElement>("#room-y0")!;
const roomX1 = document.querySelector<HTMLInputElement>("#room-x1")!;
const roomY1 = document.querySelector<HTMLInputElement>("#room-y1")!;
const addRoomBtn = document.querySelector<HTMLButtonElement>("#add-room-btn")!;

const objectListEl = document.querySelector<HTMLDivElement>("#object-list")!;
const objectIdInput = document.querySelector<HTMLInputElement>("#object-id")!;
const objectTypeSelect = document.querySelector<HTMLSelectElement>("#object-type")!;
const objectX = document.querySelector<HTMLInputElement>("#object-x")!;
const objectY = document.querySelector<HTMLInputElement>("#object-y")!;
const objectVideoId = document.querySelector<HTMLInputElement>("#object-video-id")!;
const objectCodeRow = document.querySelector<HTMLDivElement>("#object-code-row")!;
const objectCode = document.querySelector<HTMLTextAreaElement>("#object-code")!;
const addObjectBtn = document.querySelector<HTMLButtonElement>("#add-object-btn")!;

objectTypeSelect.addEventListener("change", () => {
  objectCodeRow.hidden = objectTypeSelect.value !== "script";
});

function setStatus(text: string, kind: "ok" | "err" | "" = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

async function loadMap() {
  try {
    const res = await fetch(`${SERVER_URL}/api/map`);
    if (!res.ok) throw new Error(`GET /api/map -> ${res.status}`);
    mapData = (await res.json()) as MapData;
    dimWidth.value = String(mapData.width);
    dimHeight.value = String(mapData.height);
    dimTileSize.value = String(mapData.tileSize);
    dimProximity.value = String(mapData.proximityRadius);
    render();
    setStatus("불러왔습니다.", "ok");
  } catch (err) {
    setStatus(`불러오기 실패: ${String(err)}`, "err");
  }
}

async function saveMap() {
  if (!mapData) return;
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus("관리자 토큰을 입력하세요.", "err");
    return;
  }
  try {
    const res = await fetch(`${SERVER_URL}/api/map`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(mapData),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      setStatus(`저장 실패: ${body.error ?? res.status}`, "err");
      return;
    }
    setStatus("저장 완료 — 적용하려면 서버를 재시작하세요.", "ok");
  } catch (err) {
    setStatus(`저장 실패: ${String(err)}`, "err");
  }
}

function resizeMap() {
  if (!mapData) return;
  const width = Number(dimWidth.value);
  const height = Number(dimHeight.value);
  const tileSize = Number(dimTileSize.value);
  const proximityRadius = Number(dimProximity.value);
  if (!width || !height || !tileSize || !proximityRadius) {
    setStatus("크기 값이 올바르지 않습니다.", "err");
    return;
  }

  const walls: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      row.push(mapData.walls[y]?.[x] ?? 1); // new tiles default to wall
    }
    walls.push(row);
  }

  mapData = { ...mapData, width, height, tileSize, proximityRadius, walls };
  render();
  setStatus("크기를 적용했습니다 (아직 저장 전).", "ok");
}

function render() {
  if (!mapData) return;
  drawCanvas();
  renderRoomList();
  renderObjectList();
}

function drawCanvas() {
  if (!mapData) return;
  canvas.width = mapData.width * CELL_PX;
  canvas.height = mapData.height * CELL_PX;

  for (let y = 0; y < mapData.height; y++) {
    for (let x = 0; x < mapData.width; x++) {
      ctx.fillStyle = mapData.walls[y][x] === 1 ? "#111827" : "#374151";
      ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX - 1, CELL_PX - 1);
    }
  }

  ctx.fillStyle = "#3b82f633";
  ctx.strokeStyle = "#3b82f6";
  for (const room of mapData.rooms) {
    const px = room.x0 * CELL_PX;
    const py = room.y0 * CELL_PX;
    const pw = (room.x1 - room.x0 + 1) * CELL_PX;
    const ph = (room.y1 - room.y0 + 1) * CELL_PX;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeRect(px, py, pw, ph);
  }

  const OBJECT_COLOR: Record<MapObjectType, string> = {
    whiteboard: "#f9fafb",
    youtube: "#ef4444",
    minigame: "#10b981",
    script: "#fbbf24",
  };
  for (const obj of mapData.objects) {
    ctx.fillStyle = OBJECT_COLOR[obj.type];
    const cx = obj.x * CELL_PX + CELL_PX / 2;
    const cy = obj.y * CELL_PX + CELL_PX / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL_PX / 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (mode === "room" && roomFirstCorner) {
    ctx.strokeStyle = "#f59e0b";
    ctx.strokeRect(roomFirstCorner.x * CELL_PX, roomFirstCorner.y * CELL_PX, CELL_PX, CELL_PX);
  }
}

function renderRoomList() {
  if (!mapData) return;
  roomListEl.innerHTML = "";
  for (const room of mapData.rooms) {
    const row = document.createElement("div");
    row.className = "list-row";
    const label = document.createElement("span");
    label.textContent = `#${room.id} ${room.label} (${room.x0},${room.y0})-(${room.x1},${room.y1})`;
    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => {
      if (!mapData) return;
      mapData.rooms = mapData.rooms.filter((r) => r.id !== room.id);
      render();
    });
    row.append(label, delBtn);
    roomListEl.appendChild(row);
  }
}

function renderObjectList() {
  if (!mapData) return;
  objectListEl.innerHTML = "";
  for (const obj of mapData.objects) {
    const row = document.createElement("div");
    row.className = "list-row";
    const label = document.createElement("span");
    label.textContent = `${obj.id} [${obj.type}] (${obj.x},${obj.y})${obj.videoId ? ` video=${obj.videoId}` : ""}${obj.code ? ` (script, ${obj.code.length}자)` : ""}`;
    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => {
      if (!mapData) return;
      mapData.objects = mapData.objects.filter((o) => o.id !== obj.id);
      render();
    });
    row.append(label, delBtn);
    objectListEl.appendChild(row);
  }
}

function cellFromEvent(e: MouseEvent): { x: number; y: number } | null {
  if (!mapData) return null;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL_PX);
  const y = Math.floor((e.clientY - rect.top) / CELL_PX);
  if (x < 0 || y < 0 || x >= mapData.width || y >= mapData.height) return null;
  return { x, y };
}

canvas.addEventListener("mousedown", (e) => {
  const cell = cellFromEvent(e);
  if (!cell || !mapData) return;

  if (mode === "wall") {
    dragging = true;
    paintValue = mapData.walls[cell.y][cell.x] === 1 ? 0 : 1;
    lastPaintedCell = `${cell.x},${cell.y}`;
    mapData.walls[cell.y][cell.x] = paintValue;
    render();
  } else if (mode === "room") {
    if (!roomFirstCorner) {
      roomFirstCorner = cell;
      render();
    } else {
      const x0 = Math.min(roomFirstCorner.x, cell.x);
      const x1 = Math.max(roomFirstCorner.x, cell.x);
      const y0 = Math.min(roomFirstCorner.y, cell.y);
      const y1 = Math.max(roomFirstCorner.y, cell.y);
      roomX0.value = String(x0);
      roomY0.value = String(y0);
      roomX1.value = String(x1);
      roomY1.value = String(y1);
      roomFirstCorner = null;
      render();
    }
  } else if (mode === "object") {
    objectX.value = String(cell.x);
    objectY.value = String(cell.y);
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (!dragging || mode !== "wall" || !mapData) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  const key = `${cell.x},${cell.y}`;
  if (key === lastPaintedCell) return;
  lastPaintedCell = key;
  mapData.walls[cell.y][cell.x] = paintValue;
  render();
});

window.addEventListener("mouseup", () => {
  dragging = false;
});

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode as "wall" | "room" | "object";
    roomFirstCorner = null;
    modeButtons.forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });
});

addRoomBtn.addEventListener("click", () => {
  if (!mapData) return;
  const id = Number(roomIdInput.value);
  const label = roomLabelInput.value.trim();
  const x0 = Number(roomX0.value);
  const y0 = Number(roomY0.value);
  const x1 = Number(roomX1.value);
  const y1 = Number(roomY1.value);
  if (!Number.isFinite(id) || !label || [x0, y0, x1, y1].some((v) => !Number.isFinite(v))) {
    setStatus("방 정보를 모두 입력하세요.", "err");
    return;
  }
  mapData.rooms = mapData.rooms.filter((r) => r.id !== id);
  mapData.rooms.push({ id, label, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  render();
  setStatus(`방 "${label}"을(를) 추가했습니다 (아직 저장 전).`, "ok");
});

addObjectBtn.addEventListener("click", () => {
  if (!mapData) return;
  const id = objectIdInput.value.trim();
  const type = objectTypeSelect.value as MapObjectType;
  const x = Number(objectX.value);
  const y = Number(objectY.value);
  const videoId = objectVideoId.value.trim();
  const code = objectCode.value;
  if (!id || !Number.isFinite(x) || !Number.isFinite(y)) {
    setStatus("오브젝트 정보를 모두 입력하세요.", "err");
    return;
  }
  if (type === "youtube" && !videoId) {
    setStatus("youtube 오브젝트에는 videoId가 필요합니다.", "err");
    return;
  }
  if (type === "script" && !code.trim()) {
    setStatus("script 오브젝트에는 code가 필요합니다.", "err");
    return;
  }
  mapData.objects = mapData.objects.filter((o) => o.id !== id);
  const obj: MapObjectData = { id, type, x, y };
  if (type === "youtube") obj.videoId = videoId;
  if (type === "script") obj.code = code;
  mapData.objects.push(obj);
  render();
  setStatus(`오브젝트 "${id}"를 추가했습니다 (아직 저장 전).`, "ok");
});

loadBtn.addEventListener("click", () => void loadMap());
saveBtn.addEventListener("click", () => void saveMap());
resizeBtn.addEventListener("click", resizeMap);

void loadMap();
