import type { Network } from "./network";
import type { AdminReportEntry, Player } from "./types";

/**
 * Floating admin panel, only rendered when the page URL has `?admin=TOKEN`.
 * The token itself proves nothing client-side — the server is the one that
 * validates it (see index.ts's "admin-auth") and only then honors "admin-ban"
 * from this socket. Anyone without a valid token just sees an auth failure.
 */
export class AdminPanel {
  private panelEl: HTMLDivElement;
  private listEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private reportListEl: HTMLDivElement;
  private players = new Map<string, Player>();
  private reports: AdminReportEntry[] = [];
  private selfId = "";
  private authed = false;

  constructor(
    private network: Network,
    token: string
  ) {
    this.panelEl = document.querySelector<HTMLDivElement>("#admin-panel")!;
    this.listEl = document.querySelector<HTMLDivElement>("#admin-player-list")!;
    this.statusEl = document.querySelector<HTMLDivElement>("#admin-status")!;
    this.reportListEl = document.querySelector<HTMLDivElement>("#admin-report-list")!;
    this.panelEl.hidden = false;

    this.network.sendAdminAuth(token);

    this.network.on("admin-auth-result", (payload) => {
      this.authed = payload.ok;
      this.statusEl.textContent = payload.ok ? "관리자 모드 활성화" : "관리자 인증 실패 (토큰 확인)";
      if (payload.ok) this.network.requestAdminReports();
      this.render();
    });

    this.network.on("admin-reports", (payload) => {
      this.reports = payload.reports;
      this.render();
    });

    this.network.on("init", (payload) => {
      this.selfId = payload.selfId;
      this.players.clear();
      for (const p of Object.values(payload.players)) this.players.set(p.id, p);
      this.render();
    });
    this.network.on("player-joined", (p) => {
      this.players.set(p.id, p);
      this.render();
    });
    this.network.on("player-left", (p) => {
      this.players.delete(p.id);
      this.render();
    });
  }

  private render() {
    this.listEl.innerHTML = "";
    this.reportListEl.innerHTML = "";
    if (!this.authed) return;

    for (const p of this.players.values()) {
      if (p.id === this.selfId) continue;

      const row = document.createElement("div");
      row.className = "admin-row";

      const label = document.createElement("span");
      label.textContent = p.nickname;

      const banBtn = document.createElement("button");
      banBtn.textContent = "차단";
      banBtn.addEventListener("click", () => {
        this.network.sendAdminBan(p.id);
        banBtn.disabled = true;
        banBtn.textContent = "차단됨";
      });

      row.append(label, banBtn);
      this.listEl.appendChild(row);
    }

    if (this.reports.length === 0) {
      const empty = document.createElement("div");
      empty.className = "admin-report-empty";
      empty.textContent = "신고 내역 없음";
      this.reportListEl.appendChild(empty);
      return;
    }

    for (const report of this.reports) {
      const row = document.createElement("div");
      row.className = "admin-report-row";

      const time = new Date(report.createdAt).toLocaleTimeString();
      row.innerHTML = `
        <div class="admin-report-line"><b>${escapeHtml(report.reporterNickname)}</b> → <b>${escapeHtml(report.targetNickname)}</b> <span class="admin-report-time">${time}</span></div>
        ${report.reason ? `<div class="admin-report-reason">${escapeHtml(report.reason)}</div>` : ""}
      `;
      this.reportListEl.appendChild(row);
    }
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
