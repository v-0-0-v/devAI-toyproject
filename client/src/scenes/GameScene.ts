import Phaser from "phaser";
import type { Network } from "../network";
import type { TouchControls } from "../touchControls";
import type { ObjectInteraction } from "../objectInteraction";
import type {
  Direction,
  InitPayload,
  LeftPayload,
  MapObject,
  MovedPayload,
  Player,
  RoomZone,
} from "../types";

const OBJECT_ICONS: Record<MapObject["type"], string> = {
  whiteboard: "🖊️",
  youtube: "📺",
};

interface PlayerVisual {
  container: Phaser.GameObjects.Container;
  circle: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  tileX: number;
  tileY: number;
}

const MOVE_DURATION_MS = 110;

// Digit-key -> emoji. Must match the server's REACTION_EMOJIS allowlist
// (server/src/index.ts) or the server will silently drop the reaction.
const REACTION_KEYS: Record<string, string> = {
  ONE: "👍",
  TWO: "❤️",
  THREE: "😂",
  FOUR: "😮",
  FIVE: "👏",
  SIX: "🎉",
};

export class GameScene extends Phaser.Scene {
  private network!: Network;
  private touchControls: TouchControls | null = null;
  private objectInteraction: ObjectInteraction | null = null;
  private tileSize = 32;
  private mapWidth = 0;
  private mapHeight = 0;
  private selfId = "";
  private visuals = new Map<string, PlayerVisual>();
  private objects: MapObject[] = [];
  private activeObject: MapObject | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private moveCooldown = false;

  constructor() {
    super("game");
  }

  init(data: { network: Network; touchControls?: TouchControls; objectInteraction?: ObjectInteraction }) {
    this.network = data.network;
    this.touchControls = data.touchControls ?? null;
    this.objectInteraction = data.objectInteraction ?? null;
  }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.wasd;

    for (const [key, emoji] of Object.entries(REACTION_KEYS)) {
      this.input.keyboard!.on(`keydown-${key}`, () => {
        if (this.isTypingInInput()) return;
        this.network.sendReaction(emoji);
      });
    }

    this.network.on("init", (payload) => this.handleInit(payload));
    this.network.on("player-joined", (player) => this.spawnPlayer(player));
    this.network.on("player-moved", (payload) => this.movePlayer(payload));
    this.network.on("player-left", (payload) => this.removePlayer(payload));
    this.network.on("reaction", (payload) => this.showReaction(payload.id, payload.emoji));
  }

  // While a text input (chat, nickname, ...) is focused, movement/reaction
  // keys must not fire — otherwise typing "w" or "1" in chat would also
  // move the avatar or send a reaction.
  private isTypingInInput(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
  }

  private showReaction(playerId: string, emoji: string) {
    const visual = this.visuals.get(playerId);
    if (!visual) return;

    const bubble = this.add.text(0, -this.tileSize / 2 - 26, emoji, { fontSize: "22px" });
    bubble.setOrigin(0.5, 1);
    visual.container.add(bubble);

    this.tweens.add({
      targets: bubble,
      y: bubble.y - 18,
      alpha: 0,
      duration: 1200,
      ease: "Cubic.easeOut",
      onComplete: () => bubble.destroy(),
    });
  }

  private handleInit(payload: InitPayload) {
    this.selfId = payload.selfId;
    this.tileSize = payload.map.tileSize;
    this.mapWidth = payload.map.width;
    this.mapHeight = payload.map.height;
    this.objects = payload.map.objects;

    this.cameras.main.setBackgroundColor("#111827");
    this.drawMap(payload.map.walls);
    this.drawRooms(payload.map.rooms);
    this.drawObjects(payload.map.objects);

    for (const player of Object.values(payload.players)) {
      this.spawnPlayer(player);
    }

    const selfVisual = this.visuals.get(this.selfId);
    if (selfVisual) {
      this.cameras.main.startFollow(selfVisual.container, true, 0.15, 0.15);
    }
    this.checkObjectInteraction(payload.players[this.selfId]?.x, payload.players[this.selfId]?.y);

    document.querySelector<HTMLDivElement>("#hint")!.hidden = false;
  }

  private drawMap(walls: number[][]) {
    const graphics = this.add.graphics();
    for (let y = 0; y < walls.length; y++) {
      for (let x = 0; x < walls[y].length; x++) {
        const isWall = walls[y][x] === 1;
        graphics.fillStyle(isWall ? 0x374151 : 0x1f2937, 1);
        graphics.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize - 1, this.tileSize - 1);
      }
    }

    this.cameras.main.setBounds(0, 0, this.mapWidth * this.tileSize, this.mapHeight * this.tileSize);
    this.physics.world.setBounds(0, 0, this.mapWidth * this.tileSize, this.mapHeight * this.tileSize);
  }

  // Tints a private room's floor and labels it, so it visually reads as an
  // enclosed space (its walls already block movement — see server/src/map.ts).
  private drawRooms(rooms: RoomZone[]) {
    const graphics = this.add.graphics();
    for (const room of rooms) {
      graphics.fillStyle(0x312e81, 0.55);
      for (let y = room.y0; y <= room.y1; y++) {
        for (let x = room.x0; x <= room.x1; x++) {
          graphics.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize - 1, this.tileSize - 1);
        }
      }

      const { x } = this.tileToPixel((room.x0 + room.x1) / 2, 0);
      const label = this.add.text(x, room.y0 * this.tileSize - 6, room.label, {
        fontSize: "12px",
        color: "#c7d2fe",
        backgroundColor: "#00000080",
        padding: { x: 4, y: 2 },
      });
      label.setOrigin(0.5, 1);
    }
  }

  private drawObjects(objects: MapObject[]) {
    for (const obj of objects) {
      const { x, y } = this.tileToPixel(obj.x, obj.y);
      this.add.rectangle(x, y, this.tileSize - 4, this.tileSize - 4, 0xfacc15, 0.25).setStrokeStyle(1, 0xfacc15, 0.8);
      const icon = this.add.text(x, y, OBJECT_ICONS[obj.type], { fontSize: "16px" });
      icon.setOrigin(0.5, 0.5);
    }
  }

  private findObjectAt(x: number, y: number): MapObject | undefined {
    return this.objects.find((obj) => obj.x === x && obj.y === y);
  }

  private checkObjectInteraction(x: number | undefined, y: number | undefined) {
    const obj = x !== undefined && y !== undefined ? this.findObjectAt(x, y) : undefined;
    if (obj) {
      if (this.activeObject?.id !== obj.id) {
        this.activeObject = obj;
        this.objectInteraction?.enter(obj);
      }
    } else if (this.activeObject) {
      this.activeObject = null;
      this.objectInteraction?.leave();
    }
  }

  private tileToPixel(tileX: number, tileY: number) {
    return {
      x: tileX * this.tileSize + this.tileSize / 2,
      y: tileY * this.tileSize + this.tileSize / 2,
    };
  }

  private spawnPlayer(player: Player) {
    if (this.visuals.has(player.id)) return;

    const { x, y } = this.tileToPixel(player.x, player.y);
    const isSelf = player.id === this.selfId;

    const circle = this.add.circle(0, 0, this.tileSize / 2 - 4, player.color);
    circle.setStrokeStyle(isSelf ? 3 : 1, isSelf ? 0xffffff : 0x000000, isSelf ? 1 : 0.4);

    const label = this.add.text(0, -this.tileSize / 2 - 10, player.nickname, {
      fontSize: "11px",
      color: "#ffffff",
      backgroundColor: "#00000080",
      padding: { x: 4, y: 2 },
    });
    label.setOrigin(0.5, 1);

    const container = this.add.container(x, y, [circle, label]);
    this.visuals.set(player.id, { container, circle, label, tileX: player.x, tileY: player.y });
  }

  private movePlayer(payload: MovedPayload) {
    const visual = this.visuals.get(payload.id);
    if (!visual) return;

    visual.tileX = payload.x;
    visual.tileY = payload.y;
    const { x, y } = this.tileToPixel(payload.x, payload.y);

    this.tweens.add({
      targets: visual.container,
      x,
      y,
      duration: MOVE_DURATION_MS,
      ease: "Linear",
      onComplete: () => {
        if (payload.id === this.selfId) this.moveCooldown = false;
      },
    });

    if (payload.id === this.selfId) this.checkObjectInteraction(payload.x, payload.y);
  }

  private removePlayer(payload: LeftPayload) {
    const visual = this.visuals.get(payload.id);
    if (!visual) return;
    visual.container.destroy();
    this.visuals.delete(payload.id);
  }

  update() {
    if (this.moveCooldown) return;
    if (this.isTypingInInput()) return;

    let direction: Direction | null = null;
    if (this.cursors.left.isDown || this.wasd.A.isDown) direction = "left";
    else if (this.cursors.right.isDown || this.wasd.D.isDown) direction = "right";
    else if (this.cursors.up.isDown || this.wasd.W.isDown) direction = "up";
    else if (this.cursors.down.isDown || this.wasd.S.isDown) direction = "down";
    else direction = this.touchControls?.getDirection() ?? null;

    if (direction) {
      this.moveCooldown = true;
      this.network.move(direction);
      // Fallback in case the server rejects the move (e.g. wall collision) and
      // never emits a confirming "player-moved" event for us.
      this.time.delayedCall(MOVE_DURATION_MS + 60, () => {
        this.moveCooldown = false;
      });
    }
  }
}
