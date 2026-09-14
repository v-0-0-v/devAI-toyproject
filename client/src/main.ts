import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

const loginEl = document.querySelector<HTMLDivElement>("#login")!;
const formEl = document.querySelector<HTMLFormElement>("#login-form")!;
const nicknameEl = document.querySelector<HTMLInputElement>("#nickname")!;

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const nickname = nicknameEl.value.trim();
  if (!nickname) return;

  loginEl.remove();
  startGame(nickname);
});

function startGame(nickname: string) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: Math.min(window.innerWidth, 800),
    height: Math.min(window.innerHeight, 600),
    backgroundColor: "#111827",
    physics: { default: "arcade" },
    scene: [],
  });

  game.scene.add("game", GameScene, true, { nickname });
}
