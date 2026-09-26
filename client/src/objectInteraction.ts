import type { Network } from "./network";
import type { MapObject, WhiteboardStroke } from "./types";

const YOUTUBE_EMBED_BASE = "https://www.youtube.com/embed/";

/**
 * Fixed interactive map objects (ZEP/Gather-style): walking onto a
 * whiteboard tile opens a shared drawing canvas (synced via the server's
 * whiteboard-* relay + per-board history), walking onto a YouTube tile opens
 * an embedded player. Playback isn't synced between viewers — everyone who
 * walks up controls their own embed independently.
 */
export class ObjectInteraction {
  private overlayEl: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  private whiteboardBody: HTMLDivElement;
  private youtubeBody: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private iframe: HTMLIFrameElement;

  private activeObject: MapObject | null = null;
  private drawing = false;
  private lastPoint: { x: number; y: number } | null = null;
  private currentColor = "#f9fafb";

  constructor(private network: Network) {
    this.overlayEl = document.querySelector<HTMLDivElement>("#object-overlay")!;
    this.titleEl = document.querySelector<HTMLSpanElement>("#object-overlay-title")!;
    this.whiteboardBody = document.querySelector<HTMLDivElement>("#whiteboard-body")!;
    this.youtubeBody = document.querySelector<HTMLDivElement>("#youtube-body")!;
    this.canvas = document.querySelector<HTMLCanvasElement>("#whiteboard-canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.iframe = document.querySelector<HTMLIFrameElement>("#youtube-frame")!;

    const clearBtn = document.querySelector<HTMLButtonElement>("#whiteboard-clear")!;
    clearBtn.addEventListener("click", () => {
      if (this.activeObject?.type === "whiteboard") this.network.clearWhiteboard(this.activeObject.id);
    });

    const colorBtns = Array.from(document.querySelectorAll<HTMLButtonElement>(".wb-color"));
    for (const btn of colorBtns) {
      btn.style.background = btn.dataset.color ?? "#fff";
      btn.addEventListener("click", () => {
        this.currentColor = btn.dataset.color ?? "#f9fafb";
        colorBtns.forEach((b) => b.classList.toggle("active", b === btn));
      });
    }

    this.bindDrawing();

    network.on("whiteboard-history", (payload) => {
      if (this.activeObject?.type !== "whiteboard" || this.activeObject.id !== payload.boardId) return;
      this.clearCanvas();
      for (const stroke of payload.strokes) this.drawStroke(stroke);
    });
    network.on("whiteboard-draw", (stroke) => {
      if (this.activeObject?.type === "whiteboard" && this.activeObject.id === stroke.boardId) {
        this.drawStroke(stroke);
      }
    });
    network.on("whiteboard-clear", (payload) => {
      if (this.activeObject?.type === "whiteboard" && this.activeObject.id === payload.boardId) {
        this.clearCanvas();
      }
    });
  }

  enter(obj: MapObject) {
    if (this.activeObject?.id === obj.id) return;
    this.activeObject = obj;
    this.overlayEl.hidden = false;

    if (obj.type === "whiteboard") {
      this.titleEl.textContent = "🖊️ 화이트보드";
      this.whiteboardBody.hidden = false;
      this.youtubeBody.hidden = true;
      this.clearCanvas();
      this.network.joinWhiteboard(obj.id);
    } else {
      this.titleEl.textContent = "📺 같이 보기";
      this.whiteboardBody.hidden = true;
      this.youtubeBody.hidden = false;
      this.iframe.src = obj.videoId ? `${YOUTUBE_EMBED_BASE}${obj.videoId}?autoplay=1` : "";
    }
  }

  leave() {
    if (!this.activeObject) return;
    this.activeObject = null;
    this.overlayEl.hidden = true;
    this.iframe.src = ""; // stop playback once you walk away
  }

  private bindDrawing() {
    const toBoardCoords = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    this.canvas.addEventListener("pointerdown", (e) => {
      this.drawing = true;
      this.lastPoint = toBoardCoords(e);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.drawing || !this.lastPoint || this.activeObject?.type !== "whiteboard") return;
      const point = toBoardCoords(e);
      const stroke: WhiteboardStroke = {
        boardId: this.activeObject.id,
        x0: this.lastPoint.x,
        y0: this.lastPoint.y,
        x1: point.x,
        y1: point.y,
        color: this.currentColor,
      };
      this.drawStroke(stroke);
      this.network.sendWhiteboardStroke(stroke);
      this.lastPoint = point;
    });
    const stop = () => {
      this.drawing = false;
      this.lastPoint = null;
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointerleave", stop);
  }

  private drawStroke(stroke: WhiteboardStroke) {
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(stroke.x0, stroke.y0);
    this.ctx.lineTo(stroke.x1, stroke.y1);
    this.ctx.stroke();
  }

  private clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
