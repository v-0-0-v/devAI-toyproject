/**
 * Minimal, session-scoped moderation: local mute/block only affect what
 * *this* browser tab does (never sent to or enforced by the server), and
 * reset on reload. Reporting (see videoChat.ts's 🚩 button) is the one
 * exception — it's server-persisted and admin-visible (see adminPanel.ts).
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
