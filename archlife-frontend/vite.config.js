import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Electron(file://)から index.html を直接開くため、
  // アセット参照を絶対パス("/assets/...")ではなく相対パス("./assets/...")にする。
  // これが無いと vite build 後の画面が Electron 上で真っ白になる。
  base: "./",
  server: {
    port: 5173,
  },
});
