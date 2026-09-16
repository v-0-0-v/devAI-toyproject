import type { Network } from "./network";

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export interface WebRTCCallbacks {
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onCallEnded: (peerId: string) => void;
}

/**
 * One RTCPeerConnection per nearby peer. Signaling (offer/answer/ICE) is
 * relayed through the Socket.IO server, which never inspects the payloads.
 *
 * To avoid glare (both sides creating an offer at once), only the peer with
 * the lexicographically smaller socket id initiates — the other side just
 * waits for an offer and answers it.
 */
export class WebRTCManager {
  private peers = new Map<string, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS;
  // The video track currently being sent (camera by default, screen while
  // sharing). Swapped in-place via RTCRtpSender.replaceTrack(), which — unlike
  // adding a second track — needs no renegotiation, so screen share can toggle
  // mid-call without a fresh offer/answer round trip.
  private cameraVideoTrack: MediaStreamTrack | null = null;
  private screenVideoTrack: MediaStreamTrack | null = null;

  constructor(
    private network: Network,
    private selfId: string,
    private callbacks: WebRTCCallbacks
  ) {}

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
    this.cameraVideoTrack = stream?.getVideoTracks()[0] ?? null;
  }

  /** Replaces the outgoing video track (camera -> screen) on every active peer
   * connection, and on any created afterwards. */
  async startScreenShare(track: MediaStreamTrack) {
    this.screenVideoTrack = track;
    await this.replaceVideoTrackOnAllPeers(track);
  }

  async stopScreenShare() {
    this.screenVideoTrack = null;
    await this.replaceVideoTrackOnAllPeers(this.cameraVideoTrack);
  }

  private async replaceVideoTrackOnAllPeers(track: MediaStreamTrack | null) {
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(track);
    }
  }

  /** Server-provided STUN/TURN list (see server/src/turn.ts). Falls back to
   * public STUN-only if the server didn't send any (e.g. empty array). */
  setIceServers(servers: RTCIceServer[]) {
    if (servers.length > 0) this.iceServers = servers;
  }

  private isInitiator(peerId: string): boolean {
    return this.selfId < peerId;
  }

  private getOrCreatePeer(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(peerId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        // A peer that joins while screen sharing is active should receive the
        // screen track from the start, not the camera.
        const outgoing = track.kind === "video" && this.screenVideoTrack ? this.screenVideoTrack : track;
        pc.addTrack(outgoing, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.network.sendIceCandidate(peerId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      this.callbacks.onRemoteStream(peerId, event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.closePeer(peerId);
      }
    };

    return pc;
  }

  async startCall(peerId: string) {
    if (!this.isInitiator(peerId)) return; // the other side will send an offer
    const pc = this.getOrCreatePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.network.sendOffer(peerId, offer);
  }

  async handleOffer(peerId: string, offer: RTCSessionDescriptionInit) {
    const pc = this.getOrCreatePeer(peerId);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.network.sendAnswer(peerId, answer);
  }

  async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    await pc.setRemoteDescription(answer);
  }

  async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn(`[webrtc] failed to add ICE candidate from ${peerId}`, err);
    }
  }

  closePeer(peerId: string) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    pc.close();
    this.peers.delete(peerId);
    this.callbacks.onCallEnded(peerId);
  }

  closeAll() {
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId);
  }
}
