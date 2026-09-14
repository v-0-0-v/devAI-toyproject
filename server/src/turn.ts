import crypto from "node:crypto";
import type { IceServerConfig } from "./types.js";

const TURN_SECRET = process.env.TURN_SECRET;
const TURN_URLS = (process.env.TURN_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const TURN_TTL_SECONDS = Number(process.env.TURN_TTL_SECONDS ?? 3600);

const STUN_SERVERS: IceServerConfig[] = [{ urls: "stun:stun.l.google.com:19302" }];

/**
 * Mints a coturn "REST API" style time-limited credential
 * (https://github.com/coturn/coturn/wiki/turnserver#turn-rest-api):
 * username = "<unix-expiry>:<clientId>", credential = base64(HMAC-SHA1(secret, username)).
 * coturn (configured with `use-auth-secret` + the same `--static-auth-secret`)
 * independently recomputes this HMAC to authenticate the allocation — no
 * shared database or lookup needed.
 */
function generateTurnCredential(clientId: string): IceServerConfig | null {
  if (!TURN_SECRET || TURN_URLS.length === 0) return null;

  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiry}:${clientId}`;
  const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");

  return { urls: TURN_URLS, username, credential };
}

// STUN always included; a TURN entry is added only when TURN_SECRET/TURN_URLS
// are configured, so the app degrades gracefully to STUN-only (as before)
// when no TURN server is set up.
export function buildIceServers(clientId: string): IceServerConfig[] {
  const turn = generateTurnCredential(clientId);
  return turn ? [...STUN_SERVERS, turn] : STUN_SERVERS;
}
