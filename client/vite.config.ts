import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  build: {
    // Two independent pages: the game (index.html) and the admin-only map
    // editor (editor.html, see client/src/editor.ts).
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html"),
      },
    },
  },
});
