import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  plugins: [nitro(), workflow()],
  nitro: {
    serverDir: "./src",
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
  },
});
