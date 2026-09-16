import type { Network } from "./network";
import type { ChatBroadcastPayload, ChatScope } from "./types";

const SCOPE_LABEL: Record<ChatScope, string> = {
  global: "전체",
  nearby: "근처",
};

/**
 * Text chat panel with two scopes, mirroring ZEP's 전체/프라이빗 채팅:
 * "global" reaches every player on the map, "nearby" only players currently
 * within the server's proximity radius (the same group who'd be in a video
 * call with you).
 */
export class Chat {
  private logEl: HTMLDivElement;
  private inputEl: HTMLInputElement;
  private scopeEl: HTMLSelectElement;

  constructor(private network: Network) {
    this.logEl = document.querySelector<HTMLDivElement>("#chat-log")!;
    this.inputEl = document.querySelector<HTMLInputElement>("#chat-input")!;
    this.scopeEl = document.querySelector<HTMLSelectElement>("#chat-scope")!;
    const formEl = document.querySelector<HTMLFormElement>("#chat-form")!;

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = this.inputEl.value.trim();
      if (!text) return;
      this.network.sendChatMessage(this.scopeEl.value as ChatScope, text);
      this.inputEl.value = "";
      this.inputEl.focus();
    });

    // Blur the input on Escape so movement keys work again without a click.
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.inputEl.blur();
    });

    this.network.on("chat-message", (payload) => this.appendMessage(payload));
  }

  private appendMessage(payload: ChatBroadcastPayload) {
    const line = document.createElement("div");
    line.className = `chat-line chat-line--${payload.scope}`;

    const tag = document.createElement("span");
    tag.className = "chat-tag";
    tag.textContent = `[${SCOPE_LABEL[payload.scope]}]`;

    const nick = document.createElement("span");
    nick.className = "chat-nick";
    nick.textContent = `${payload.nickname}:`;

    const text = document.createElement("span");
    text.className = "chat-text";
    text.textContent = payload.text;

    line.append(tag, document.createTextNode(" "), nick, document.createTextNode(" "), text);
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
