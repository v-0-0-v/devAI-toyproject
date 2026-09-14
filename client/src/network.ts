import { io, Socket } from "socket.io-client";
import type { Direction, InitPayload, LeftPayload, MovedPayload, Player } from "./types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export interface NetworkHandlers {
  onInit: (payload: InitPayload) => void;
  onPlayerJoined: (player: Player) => void;
  onPlayerMoved: (payload: MovedPayload) => void;
  onPlayerLeft: (payload: LeftPayload) => void;
}

export class Network {
  private socket: Socket;

  constructor(nickname: string, handlers: NetworkHandlers) {
    this.socket = io(SERVER_URL, { transports: ["websocket"] });

    this.socket.on("connect", () => {
      this.socket.emit("join", nickname);
    });
    this.socket.on("init", handlers.onInit);
    this.socket.on("player-joined", handlers.onPlayerJoined);
    this.socket.on("player-moved", handlers.onPlayerMoved);
    this.socket.on("player-left", handlers.onPlayerLeft);
  }

  move(direction: Direction) {
    this.socket.emit("move", direction);
  }
}
