import type { Redis } from "ioredis";
import type { GameStore } from "./store.js";
import type { Player, WhiteboardStroke } from "./types.js";

const PLAYERS_KEY = "zep:players";
const CALL_PAIRS_KEY = "zep:call-pairs";
const BANNED_IPS_KEY = "zep:banned-ips";
const SOCKET_IPS_KEY = "zep:socket-ips";
const whiteboardKey = (boardId: string) => `zep:whiteboard:${boardId}`;

/** Redis-backed GameStore so every instance behind a load balancer sees the
 * same players/calls/whiteboard/bans. See store.ts's GameStore doc comment
 * for what this deliberately does NOT cover (minigame matchmaking). */
export class RedisGameStore implements GameStore {
  constructor(private redis: Redis) {}

  async getPlayer(id: string) {
    const raw = await this.redis.hget(PLAYERS_KEY, id);
    return raw ? (JSON.parse(raw) as Player) : undefined;
  }
  async setPlayer(player: Player) {
    await this.redis.hset(PLAYERS_KEY, player.id, JSON.stringify(player));
  }
  async deletePlayer(id: string) {
    await this.redis.hdel(PLAYERS_KEY, id);
  }
  async allPlayers() {
    const raw = await this.redis.hgetall(PLAYERS_KEY);
    return Object.values(raw).map((v) => JSON.parse(v) as Player);
  }

  async hasCallPair(key: string) {
    return (await this.redis.sismember(CALL_PAIRS_KEY, key)) === 1;
  }
  async addCallPair(key: string) {
    await this.redis.sadd(CALL_PAIRS_KEY, key);
  }
  async removeCallPair(key: string) {
    await this.redis.srem(CALL_PAIRS_KEY, key);
  }
  async allCallPairs() {
    return this.redis.smembers(CALL_PAIRS_KEY);
  }

  async getWhiteboardHistory(boardId: string) {
    const raw = await this.redis.lrange(whiteboardKey(boardId), 0, -1);
    return raw.map((v) => JSON.parse(v) as WhiteboardStroke);
  }
  async pushWhiteboardStroke(boardId: string, stroke: WhiteboardStroke, limit: number) {
    const key = whiteboardKey(boardId);
    await this.redis.rpush(key, JSON.stringify(stroke));
    await this.redis.ltrim(key, -limit, -1);
  }
  async clearWhiteboardHistory(boardId: string) {
    await this.redis.del(whiteboardKey(boardId));
  }

  async setSocketIp(socketId: string, ip: string) {
    await this.redis.hset(SOCKET_IPS_KEY, socketId, ip);
  }
  async getSocketIp(socketId: string) {
    const ip = await this.redis.hget(SOCKET_IPS_KEY, socketId);
    return ip ?? undefined;
  }
  async deleteSocketIp(socketId: string) {
    await this.redis.hdel(SOCKET_IPS_KEY, socketId);
  }
  async isBannedIp(ip: string) {
    return (await this.redis.sismember(BANNED_IPS_KEY, ip)) === 1;
  }
  async banIp(ip: string) {
    await this.redis.sadd(BANNED_IPS_KEY, ip);
  }
}
