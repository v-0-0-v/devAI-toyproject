import type { Network } from "./network";
import type { MinigameResultPayload, RpsChoice } from "./types";

const CHOICE_LABEL: Record<RpsChoice, string> = {
  rock: "✊ 바위",
  paper: "✋ 보",
  scissors: "✌️ 가위",
};

const OUTCOME_LABEL: Record<MinigameResultPayload["outcome"], string> = {
  win: "승리! 🎉",
  lose: "패배 😢",
  draw: "무승부",
};

/**
 * Rock-paper-scissors, ZEP/Gather-style minigame object: walking onto the
 * tile queues you for the next opponent (or matches you with whoever's
 * already waiting there). Purely relayed through the server — see
 * server/src/index.ts's minigame-* handlers.
 */
export class Minigame {
  private panelEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private choicesEl: HTMLDivElement;
  private resultEl: HTMLDivElement;
  private activeObjectId: string | null = null;

  constructor(private network: Network) {
    this.panelEl = document.querySelector<HTMLDivElement>("#minigame-panel")!;
    this.statusEl = document.querySelector<HTMLDivElement>("#minigame-status")!;
    this.choicesEl = document.querySelector<HTMLDivElement>("#minigame-choices")!;
    this.resultEl = document.querySelector<HTMLDivElement>("#minigame-result")!;

    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>("#minigame-choices button"))) {
      btn.addEventListener("click", () => {
        const choice = btn.dataset.choice as RpsChoice;
        this.network.sendMinigameChoice(choice);
        this.statusEl.textContent = "상대의 선택을 기다리는 중...";
      });
    }

    network.on("minigame-waiting", () => {
      this.statusEl.textContent = "상대를 기다리는 중...";
      this.choicesEl.hidden = true;
      this.resultEl.textContent = "";
    });
    network.on("minigame-matched", () => {
      this.statusEl.textContent = "상대를 찾았습니다! 선택하세요.";
      this.choicesEl.hidden = false;
      this.resultEl.textContent = "";
    });
    network.on("minigame-result", (payload) => this.showResult(payload));
    network.on("minigame-opponent-left", () => {
      this.statusEl.textContent = "상대가 나갔습니다. 다시 기다리는 중...";
      this.choicesEl.hidden = true;
      this.resultEl.textContent = "";
      if (this.activeObjectId) this.network.joinMinigame(this.activeObjectId);
    });
  }

  enter(objectId: string) {
    if (this.activeObjectId === objectId) return;
    this.activeObjectId = objectId;
    this.panelEl.hidden = false;
    this.choicesEl.hidden = true;
    this.resultEl.textContent = "";
    this.statusEl.textContent = "상대를 찾는 중...";
    this.network.joinMinigame(objectId);
  }

  leave() {
    if (!this.activeObjectId) return;
    this.activeObjectId = null;
    this.panelEl.hidden = true;
    this.network.leaveMinigame();
  }

  private showResult(payload: MinigameResultPayload) {
    this.statusEl.textContent = "다시 선택해서 재도전할 수 있어요.";
    this.choicesEl.hidden = false;
    this.resultEl.textContent =
      `나: ${CHOICE_LABEL[payload.yourChoice]} vs 상대: ${CHOICE_LABEL[payload.opponentChoice]} — ` +
      OUTCOME_LABEL[payload.outcome];
  }
}
