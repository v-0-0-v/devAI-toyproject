import type { Network } from "./network";
import { WebRTCManager } from "./webrtc";
import type { InitPayload, Player } from "./types";

interface VideoTile {
  root: HTMLDivElement;
  video: HTMLVideoElement;
}

/**
 * Owns the local camera/mic stream, the video tile bar (DOM overlay on top
 * of the Phaser canvas), and a WebRTCManager that starts/stops one
 * RTCPeerConnection per nearby player based on server "proximity-*" events.
 */
export class VideoChat {
  private webrtc: WebRTCManager | null = null;
  private nicknames = new Map<string, string>();
  private tiles = new Map<string, VideoTile>();
  private barEl: HTMLDivElement;
  private micEnabled = true;
  private camEnabled = true;

  constructor(
    private network: Network,
    private localStream: MediaStream | null
  ) {
    this.barEl = document.querySelector<HTMLDivElement>("#video-bar")!;
    this.renderLocalTile();

    network.on("init", (payload) => this.handleInit(payload));
    network.on("player-joined", (player) => this.nicknames.set(player.id, player.nickname));
    network.on("player-left", (payload) => this.webrtc?.closePeer(payload.id));
    network.on("proximity-joined", (payload) => {
      this.nicknames.set(payload.peerId, payload.nickname);
      this.webrtc?.startCall(payload.peerId);
    });
    network.on("proximity-left", (payload) => this.webrtc?.closePeer(payload.peerId));

    network.on("webrtc-offer", async ({ from, offer }) => {
      await this.webrtc?.handleOffer(from, offer);
    });
    network.on("webrtc-answer", async ({ from, answer }) => {
      await this.webrtc?.handleAnswer(from, answer);
    });
    network.on("webrtc-ice-candidate", async ({ from, candidate }) => {
      await this.webrtc?.handleIceCandidate(from, candidate);
    });
  }

  private handleInit(payload: InitPayload) {
    for (const player of Object.values(payload.players) as Player[]) {
      this.nicknames.set(player.id, player.nickname);
    }

    this.webrtc = new WebRTCManager(this.network, payload.selfId, {
      onRemoteStream: (peerId, stream) => this.showRemoteStream(peerId, stream),
      onCallEnded: (peerId) => this.removeTile(peerId),
    });
    this.webrtc.setIceServers(payload.iceServers);
    this.webrtc.setLocalStream(this.localStream);
  }

  private renderLocalTile() {
    const { root, video } = this.createTile("나", true);
    if (this.localStream) {
      video.srcObject = this.localStream;
      root.appendChild(this.createControls());
    } else {
      root.classList.add("no-media");
      root.textContent = "카메라/마이크 사용 불가\n(권한 거부 또는 미지원)";
    }
    this.barEl.appendChild(root);
  }

  private createControls(): HTMLDivElement {
    const controls = document.createElement("div");
    controls.className = "video-controls";

    const micBtn = document.createElement("button");
    micBtn.textContent = "🎤";
    micBtn.title = "마이크 켜기/끄기";
    micBtn.addEventListener("click", () => {
      this.micEnabled = !this.micEnabled;
      this.localStream?.getAudioTracks().forEach((track) => (track.enabled = this.micEnabled));
      micBtn.classList.toggle("off", !this.micEnabled);
    });

    const camBtn = document.createElement("button");
    camBtn.textContent = "📷";
    camBtn.title = "카메라 켜기/끄기";
    camBtn.addEventListener("click", () => {
      this.camEnabled = !this.camEnabled;
      this.localStream?.getVideoTracks().forEach((track) => (track.enabled = this.camEnabled));
      camBtn.classList.toggle("off", !this.camEnabled);
    });

    controls.appendChild(micBtn);
    controls.appendChild(camBtn);
    return controls;
  }

  private createTile(label: string, muted: boolean): VideoTile {
    const root = document.createElement("div");
    root.className = "video-tile";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;
    root.appendChild(video);

    const labelEl = document.createElement("span");
    labelEl.className = "video-label";
    labelEl.textContent = label;
    root.appendChild(labelEl);

    return { root, video };
  }

  private showRemoteStream(peerId: string, stream: MediaStream) {
    let tile = this.tiles.get(peerId);
    if (!tile) {
      tile = this.createTile(this.nicknames.get(peerId) ?? "참가자", false);
      this.tiles.set(peerId, tile);
      this.barEl.appendChild(tile.root);
    }
    tile.video.srcObject = stream;
  }

  private removeTile(peerId: string) {
    const tile = this.tiles.get(peerId);
    if (!tile) return;
    tile.root.remove();
    this.tiles.delete(peerId);
  }
}
