import type { Network } from "./network";
import { WebRTCManager } from "./webrtc";
import type { InitPayload, Player } from "./types";

// Must match server/src/map.ts's PROXIMITY_RADIUS — used only as the point at
// which spatial audio has faded to silence, not for any connect/disconnect
// decision (the server alone decides who is "in a call").
const PROXIMITY_RADIUS = 3;

interface VideoTile {
  root: HTMLDivElement;
  video: HTMLVideoElement;
}

/**
 * Owns the local camera/mic stream, the video tile bar (DOM overlay on top
 * of the Phaser canvas), and a WebRTCManager that starts/stops one
 * RTCPeerConnection per nearby player based on server "proximity-*" events.
 *
 * Also renders remote audio through a Web Audio spatial graph (distance-based
 * volume + stereo panning, like ZEP/Gather) instead of playing it directly
 * through the <video> element, and can swap the outgoing video track to a
 * screen-capture stream (same track slot, so no renegotiation is needed).
 */
export class VideoChat {
  private webrtc: WebRTCManager | null = null;
  private nicknames = new Map<string, string>();
  private tiles = new Map<string, VideoTile>();
  private barEl: HTMLDivElement;
  private micEnabled = true;
  private camEnabled = true;

  private selfId = "";
  private positions = new Map<string, { x: number; y: number }>();
  private audioCtx: AudioContext | null = null;
  private spatialNodes = new Map<string, { source: MediaStreamAudioSourceNode; panner: PannerNode }>();

  private localVideoEl: HTMLVideoElement | null = null;
  private screenStream: MediaStream | null = null;
  private screenBtn: HTMLButtonElement | null = null;

  constructor(
    private network: Network,
    private localStream: MediaStream | null
  ) {
    this.barEl = document.querySelector<HTMLDivElement>("#video-bar")!;
    this.renderLocalTile();

    network.on("init", (payload) => this.handleInit(payload));
    network.on("player-joined", (player) => {
      this.nicknames.set(player.id, player.nickname);
      this.positions.set(player.id, { x: player.x, y: player.y });
    });
    network.on("player-moved", (payload) => {
      this.positions.set(payload.id, { x: payload.x, y: payload.y });
      if (payload.id === this.selfId) {
        for (const peerId of this.spatialNodes.keys()) this.refreshPanner(peerId);
      } else {
        this.refreshPanner(payload.id);
      }
    });
    network.on("player-left", (payload) => {
      this.positions.delete(payload.id);
      this.webrtc?.closePeer(payload.id);
    });
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
    this.selfId = payload.selfId;
    for (const player of Object.values(payload.players) as Player[]) {
      this.nicknames.set(player.id, player.nickname);
      this.positions.set(player.id, { x: player.x, y: player.y });
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
      this.localVideoEl = video;
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

    const screenBtn = document.createElement("button");
    screenBtn.textContent = "🖥️";
    screenBtn.title = "화면 공유 시작/중지";
    screenBtn.addEventListener("click", () => this.toggleScreenShare());
    this.screenBtn = screenBtn;

    controls.appendChild(micBtn);
    controls.appendChild(camBtn);
    controls.appendChild(screenBtn);
    return controls;
  }

  // Screen share reuses the camera's video track slot on every peer
  // connection via RTCRtpSender.replaceTrack() (see webrtc.ts), so toggling
  // it needs no renegotiation — the remote tile just starts/stops showing the
  // screen instead of a separate tile.
  private async toggleScreenShare() {
    if (this.screenStream) {
      this.stopScreenShare();
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert("이 브라우저는 화면 공유를 지원하지 않습니다.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      this.screenStream = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener("ended", () => this.stopScreenShare());

      await this.webrtc?.startScreenShare(track);
      if (this.localVideoEl) this.localVideoEl.srcObject = stream;
      this.screenBtn?.classList.add("active");
    } catch (err) {
      console.warn("화면 공유를 시작할 수 없습니다:", err);
    }
  }

  private stopScreenShare() {
    if (!this.screenStream) return;
    for (const track of this.screenStream.getTracks()) track.stop();
    this.screenStream = null;
    this.webrtc?.stopScreenShare();
    if (this.localVideoEl && this.localStream) this.localVideoEl.srcObject = this.localStream;
    this.screenBtn?.classList.remove("active");
  }

  private createTile(label: string, muted: boolean): VideoTile {
    const root = document.createElement("div");
    root.className = "video-tile";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    // Audio always stays muted at the <video> element: for the local tile to
    // avoid mic feedback, for remote tiles because their audio is instead
    // routed through the spatial Web Audio graph below.
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
      tile = this.createTile(this.nicknames.get(peerId) ?? "참가자", true);
      this.tiles.set(peerId, tile);
      this.barEl.appendChild(tile.root);
    }
    tile.video.srcObject = stream;
    this.connectSpatialAudio(peerId, stream);
  }

  private removeTile(peerId: string) {
    this.disconnectSpatialAudio(peerId);
    const tile = this.tiles.get(peerId);
    if (!tile) return;
    tile.root.remove();
    this.tiles.delete(peerId);
  }

  // --- Spatial audio -------------------------------------------------

  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      // Browsers can start a freshly-created AudioContext "suspended" unless
      // creation happens directly inside a user-gesture handler; the login
      // form submit involves an intervening `await` (camera permission
      // prompt) that can break that chain, so retry resuming on the next
      // interaction as a fallback.
      const resume = () => void this.audioCtx?.resume();
      document.addEventListener("pointerdown", resume, { once: true });
      document.addEventListener("keydown", resume, { once: true });
    }
    return this.audioCtx;
  }

  private connectSpatialAudio(peerId: string, stream: MediaStream) {
    this.disconnectSpatialAudio(peerId);
    if (stream.getAudioTracks().length === 0) return;

    const ctx = this.ensureAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const panner = ctx.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "linear";
    panner.refDistance = 1;
    panner.maxDistance = PROXIMITY_RADIUS + 1;
    panner.rolloffFactor = 1;
    source.connect(panner).connect(ctx.destination);

    this.spatialNodes.set(peerId, { source, panner });
    this.refreshPanner(peerId);
  }

  private disconnectSpatialAudio(peerId: string) {
    const nodes = this.spatialNodes.get(peerId);
    if (!nodes) return;
    nodes.source.disconnect();
    nodes.panner.disconnect();
    this.spatialNodes.delete(peerId);
  }

  private refreshPanner(peerId: string) {
    const nodes = this.spatialNodes.get(peerId);
    if (!nodes) return;
    const self = this.positions.get(this.selfId);
    const peer = this.positions.get(peerId);
    if (!self || !peer) return;
    nodes.panner.positionX.value = peer.x - self.x;
    nodes.panner.positionZ.value = peer.y - self.y;
  }
}
