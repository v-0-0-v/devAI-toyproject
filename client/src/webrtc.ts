import { Device } from "mediasoup-client";
import type { Transport, Producer, Consumer } from "mediasoup-client/types";
import type { Network } from "./network";
import type { SfuMediaKind } from "./types";

export interface WebRTCCallbacks {
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onCallEnded: (peerId: string) => void;
}

/**
 * Sends this client's camera/mic to the server exactly once, through a
 * mediasoup SFU (see server/src/sfu.ts's doc comment for why), and consumes
 * whichever other players are currently "in a call" with us per server
 * "proximity-joined"/"proximity-left" events. This replaces the old design
 * of one RTCPeerConnection per nearby peer — there is no P2P connection
 * anymore, the server always relays, so NAT traversal between two clients is
 * no longer this app's problem (which is also why TURN/coturn is no longer
 * wired into this path).
 *
 * The public API is intentionally unchanged from the old P2P version
 * (startCall/closePeer/closeAll/setLocalStream/startScreenShare/
 * stopScreenShare, the same onRemoteStream/onCallEnded callbacks) so
 * videoChat.ts needed almost no changes beyond removing the old
 * webrtc-offer/answer/ice-candidate wiring.
 */
export class WebRTCManager {
  private device = new Device();
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers = new Map<SfuMediaKind, Producer>();
  private consumers = new Map<string, Consumer>(); // consumerId -> Consumer
  private consumersByPeer = new Map<string, Set<string>>(); // peerId -> consumerIds
  private remoteStreams = new Map<string, MediaStream>(); // peerId -> combined stream
  private localStream: MediaStream | null = null;
  private cameraVideoTrack: MediaStreamTrack | null = null;
  private ready: Promise<void>;

  constructor(
    private network: Network,
    _selfId: string,
    private callbacks: WebRTCCallbacks
  ) {
    this.ready = this.init();

    // A producer that starts a moment after proximity-joined already fired
    // (e.g. this peer's own camera was still initializing) wouldn't
    // otherwise reach us — the server pushes it explicitly instead.
    this.network.on("sfu-new-producer", ({ peerId, producerId }) => {
      void this.consumeOne(peerId, producerId);
    });
  }

  private async init() {
    const rtpCapabilities = await this.network.sfuGetRouterRtpCapabilities();
    await this.device.load({
      routerRtpCapabilities: rtpCapabilities as Parameters<Device["load"]>[0]["routerRtpCapabilities"],
    });
    await this.network.sfuSetRtpCapabilities(this.device.recvRtpCapabilities);
    await Promise.all([this.createSendTransport(), this.createRecvTransport()]);
    // Transports are ready now — safe to produce directly (unlike
    // setLocalStream() below, this call isn't waiting on `this.ready`, which
    // is this very method's own not-yet-resolved promise).
    await this.produceLocalStream();
  }

  private async createSendTransport() {
    const options = await this.network.sfuCreateTransport("send");
    if (!options) return;
    const transport = this.device.createSendTransport(options as Parameters<Device["createSendTransport"]>[0]);

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.network
        .sfuConnectTransport(transport.id, dtlsParameters)
        .then(() => callback())
        .catch(errback);
    });
    transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
      this.network
        .sfuProduce(transport.id, kind as SfuMediaKind, rtpParameters)
        .then((res) => (res ? callback(res) : errback(new Error("sfu-produce failed"))))
        .catch(errback);
    });

    this.sendTransport = transport;
  }

  private async createRecvTransport() {
    const options = await this.network.sfuCreateTransport("recv");
    if (!options) return;
    const transport = this.device.createRecvTransport(options as Parameters<Device["createRecvTransport"]>[0]);

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.network
        .sfuConnectTransport(transport.id, dtlsParameters)
        .then(() => callback())
        .catch(errback);
    });

    this.recvTransport = transport;
  }

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
    this.cameraVideoTrack = stream?.getVideoTracks()[0] ?? null;
    // May be called before init() finishes (main.ts sets the stream right
    // after construction) — wait for transports here rather than inside
    // produceLocalStream() itself, since init() also calls that method
    // directly once transports are ready, and awaiting `this.ready` from
    // within the call that resolves it would deadlock.
    void this.ready.then(() => this.produceLocalStream());
  }

  private async produceLocalStream() {
    if (!this.localStream || !this.sendTransport) return;
    for (const track of this.localStream.getTracks()) {
      const kind = track.kind as SfuMediaKind;
      if (this.producers.has(kind)) continue;
      const producer = await this.sendTransport.produce({ track });
      this.producers.set(kind, producer);
    }
  }

  /** Starts consuming a peer's current (and any future) producers. */
  async startCall(peerId: string) {
    await this.ready;
    const { consumers } = await this.network.sfuConsumePeer(peerId);
    for (const c of consumers) await this.applyConsumer(peerId, c);
  }

  private async consumeOne(peerId: string, producerId: string) {
    await this.ready;
    const c = await this.network.sfuConsume(producerId);
    if (c) await this.applyConsumer(peerId, c);
  }

  private async applyConsumer(
    peerId: string,
    c: { id: string; producerId: string; kind: SfuMediaKind; rtpParameters: unknown }
  ) {
    if (!this.recvTransport || this.consumers.has(c.id)) return;

    const consumer = await this.recvTransport.consume({
      id: c.id,
      producerId: c.producerId,
      kind: c.kind,
      rtpParameters: c.rtpParameters as Parameters<Transport["consume"]>[0]["rtpParameters"],
    });
    this.consumers.set(consumer.id, consumer);
    if (!this.consumersByPeer.has(peerId)) this.consumersByPeer.set(peerId, new Set());
    this.consumersByPeer.get(peerId)!.add(consumer.id);
    await this.network.sfuResumeConsumer(consumer.id); // consumers start paused server-side

    let stream = this.remoteStreams.get(peerId);
    if (!stream) {
      stream = new MediaStream();
      this.remoteStreams.set(peerId, stream);
    }
    stream.addTrack(consumer.track);
    this.callbacks.onRemoteStream(peerId, stream);
  }

  /** Swaps the outgoing video track (camera -> screen) with no renegotiation
   * — every consumer of this producer picks up the new track transparently. */
  async startScreenShare(track: MediaStreamTrack) {
    const producer = this.producers.get("video");
    if (producer) await producer.replaceTrack({ track });
  }

  async stopScreenShare() {
    const producer = this.producers.get("video");
    if (producer) await producer.replaceTrack({ track: this.cameraVideoTrack });
  }

  closePeer(peerId: string) {
    const ids = this.consumersByPeer.get(peerId);
    if (ids) {
      for (const id of ids) {
        this.consumers.get(id)?.close();
        this.consumers.delete(id);
      }
      this.consumersByPeer.delete(peerId);
    }
    this.remoteStreams.delete(peerId);
    void this.network.sfuCloseConsumersForPeer(peerId);
    this.callbacks.onCallEnded(peerId);
  }

  closeAll() {
    for (const peerId of [...this.consumersByPeer.keys()]) this.closePeer(peerId);
  }
}
