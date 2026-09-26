import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";
import { Network } from "./network";
import { VideoChat } from "./videoChat";
import { Chat } from "./chat";
import { TouchControls } from "./touchControls";
import { ObjectInteraction } from "./objectInteraction";
import { Moderation } from "./moderation";

const loginEl = document.querySelector<HTMLDivElement>("#login")!;
const formEl = document.querySelector<HTMLFormElement>("#login-form")!;
const nicknameEl = document.querySelector<HTMLInputElement>("#nickname")!;
const submitBtn = formEl.querySelector<HTMLButtonElement>("button[type=submit]")!;

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nickname = nicknameEl.value.trim();
  if (!nickname) return;

  const colorInput = formEl.querySelector<HTMLInputElement>('input[name="avatar-color"]:checked');
  const color = colorInput ? Number(colorInput.value) : undefined;

  submitBtn.disabled = true;
  submitBtn.textContent = "카메라/마이크 권한 확인 중...";
  const localStream = await requestLocalMedia();

  loginEl.remove();

  const network = new Network(nickname, color);
  const moderation = new Moderation();
  new VideoChat(network, localStream, moderation);
  new Chat(network, moderation);
  const touchControls = new TouchControls();
  const objectInteraction = new ObjectInteraction(network);
  startGame(network, touchControls, objectInteraction);
});

async function requestLocalMedia(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    console.warn("카메라/마이크 권한을 사용할 수 없습니다:", err);
    return null;
  }
}

function startGame(network: Network, touchControls: TouchControls, objectInteraction: ObjectInteraction) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: Math.min(window.innerWidth, 800),
    height: Math.min(window.innerHeight, 600),
    backgroundColor: "#111827",
    physics: { default: "arcade" },
    scene: [],
  });

  game.scene.add("game", GameScene, true, { network, touchControls, objectInteraction });
}
