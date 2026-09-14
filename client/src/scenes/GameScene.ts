import Phaser from "phaser";
import type { Network } from "../network";
import type { Direction, InitPayload, LeftPayload, MovedPayload, Player } from "../types";

interface PlayerVisual {
  container: Phaser.GameObjects.Container;
  circle: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  tileX: number;
  tileY: number;
}

const MOVE_DURATION_MS = 110;

export class GameScene extends Phaser.Scene {
  private network!: Network;
  private tileSize = 32;
  private mapWidth = 0;
  private mapHeight = 0;
  private selfId = "";
  private visuals = new Map<string, PlayerVisual>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private moveCooldown = false;

  constructor() {
    super("game");
  }

  init(data: { network: Network }) {
    this.network = data.network;
  }

  create() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.wasd;

    this.network.on("init", (payload) => this.handleInit(payload));
    this.network.on("player-joined", (player) => this.spawnPlayer(player));
    this.network.on("player-moved", (payload) => this.movePlayer(payload));
    this.network.on("player-left", (payload) => this.removePlayer(payload));
  }

  private handleInit(payload: InitPayload) {
    this.selfId = payload.selfId;
    this.tileSize = payload.map.tileSize;
    this.mapWidth = payload.map.width;
    this.mapHeight = payload.map.height;

    this.cameras.main.setBackgroundColor("#111827");
    this.drawMap(payload.map.walls);

    for (const player of Object.values(payload.players)) {
      this.spawnPlayer(player);
    }

    const selfVisual = this.visuals.get(this.selfId);
    if (selfVisual) {
      this.cameras.main.startFollow(selfVisual.container, true, 0.15, 0.15);
    }

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
  }

  private removePlayer(payload: LeftPayload) {
    const visual = this.visuals.get(payload.id);
    if (!visual) return;
    visual.container.destroy();
    this.visuals.delete(payload.id);
  }

  update() {
    if (this.moveCooldown) return;

    let direction: Direction | null = null;
    if (this.cursors.left.isDown || this.wasd.A.isDown) direction = "left";
    else if (this.cursors.right.isDown || this.wasd.D.isDown) direction = "right";
    else if (this.cursors.up.isDown || this.wasd.W.isDown) direction = "up";
    else if (this.cursors.down.isDown || this.wasd.S.isDown) direction = "down";

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
