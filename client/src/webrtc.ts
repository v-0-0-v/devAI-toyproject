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

  constructor(
    private network: Network,
    private selfId: string,
    private callbacks: WebRTCCallbacks
  ) {}

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
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
        pc.addTrack(track, this.localStream);
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
