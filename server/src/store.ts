import type { Player, WhiteboardStroke } from "./types.js";

/**
 * Everything the game server needs to remember, abstracted so a single
 * process can run entirely in memory (the default — `npm run dev` needs no
 * extra infra) while a horizontally-scaled deployment can point every
 * instance at the same Redis so they share one consistent view of who's
 * online, who's in a call, what's on the whiteboard, and who's banned.
 *
 * Socket.IO's Redis adapter (see index.ts) only synchronizes broadcast/relay
 * messaging across instances — it does nothing for *application* state like
 * this, which is why this abstraction exists at all.
 *
 * Not covered here: minigame matchmaking (see index.ts's `minigameWaiting`),
 * which stays purely in-memory per instance. Pairing two players requires an
 * atomic "claim the waiting slot" step; doing that safely across instances
 * needs a Lua script or WATCH/MULTI, which is more machinery than a mini MVP
 * minigame warrants. In a multi-instance deployment, two players can only be
 * matched if their sockets happen to land on the same instance.
 */
export interface GameStore {
  getPlayer(id: string): Promise<Player | undefined>;
  setPlayer(player: Player): Promise<void>;
  deletePlayer(id: string): Promise<void>;
  allPlayers(): Promise<Player[]>;

  hasCallPair(key: string): Promise<boolean>;
  addCallPair(key: string): Promise<void>;
  removeCallPair(key: string): Promise<void>;
  allCallPairs(): Promise<string[]>;

  getWhiteboardHistory(boardId: string): Promise<WhiteboardStroke[]>;
  pushWhiteboardStroke(boardId: string, stroke: WhiteboardStroke, limit: number): Promise<void>;
  clearWhiteboardHistory(boardId: string): Promise<void>;

  setSocketIp(socketId: string, ip: string): Promise<void>;
  getSocketIp(socketId: string): Promise<string | undefined>;
  deleteSocketIp(socketId: string): Promise<void>;
  isBannedIp(ip: string): Promise<boolean>;
  banIp(ip: string): Promise<void>;
}

export class MemoryGameStore implements GameStore {
  private players = new Map<string, Player>();
  private callPairs = new Set<string>();
  private whiteboardHistory = new Map<string, WhiteboardStroke[]>();
  private socketIps = new Map<string, string>();
  private bannedIps = new Set<string>();

  async getPlayer(id: string) {
    return this.players.get(id);
  }
  async setPlayer(player: Player) {
    this.players.set(player.id, player);
  }
  async deletePlayer(id: string) {
    this.players.delete(id);
  }
  async allPlayers() {
    return [...this.players.values()];
  }

  async hasCallPair(key: string) {
    return this.callPairs.has(key);
  }
  async addCallPair(key: string) {
    this.callPairs.add(key);
  }
  async removeCallPair(key: string) {
    this.callPairs.delete(key);
  }
  async allCallPairs() {
    return [...this.callPairs];
  }

  async getWhiteboardHistory(boardId: string) {
    return this.whiteboardHistory.get(boardId) ?? [];
  }
  async pushWhiteboardStroke(boardId: string, stroke: WhiteboardStroke, limit: number) {
    const history = this.whiteboardHistory.get(boardId) ?? [];
    history.push(stroke);
    if (history.length > limit) history.shift();
    this.whiteboardHistory.set(boardId, history);
  }
  async clearWhiteboardHistory(boardId: string) {
    this.whiteboardHistory.set(boardId, []);
  }

  async setSocketIp(socketId: string, ip: string) {
    this.socketIps.set(socketId, ip);
  }
  async getSocketIp(socketId: string) {
    return this.socketIps.get(socketId);
  }
  async deleteSocketIp(socketId: string) {
    this.socketIps.delete(socketId);
  }
  async isBannedIp(ip: string) {
    return this.bannedIps.has(ip);
  }
  async banIp(ip: string) {
    this.bannedIps.add(ip);
  }
}
