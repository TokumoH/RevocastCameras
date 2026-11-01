import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        send: resolve(__dirname, "send.html"),
        receive: resolve(__dirname, "receive.html"),
      },
    },
  },
});