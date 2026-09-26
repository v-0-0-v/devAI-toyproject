/**
 * Minimal, session-scoped moderation: local mute/block only affect what
 * *this* browser tab does (never sent to or enforced by the server), and
 * reset on reload. There's no persistence and no admin UI in this MVP —
 * the goal is just to have the mute/block/report pipeline exist end to end,
 * matching ZEP/Gather's baseline safety tools at a scale a mini MVP warrants.
 */
export class Moderation {
  private blocked = new Set<string>();
  private mutedLocally = new Set<string>();

  isBlocked(peerId: string): boolean {
    return this.blocked.has(peerId);
  }

  block(peerId: string) {
    this.blocked.add(peerId);
  }

  isMutedLocally(peerId: string): boolean {
    return this.mutedLocally.has(peerId);
  }

  /** Returns the new muted state. */
  toggleMuteLocally(peerId: string): boolean {
    if (this.mutedLocally.has(peerId)) {
      this.mutedLocally.delete(peerId);
      return false;
    }
    this.mutedLocally.add(peerId);
    return true;
  }
}
