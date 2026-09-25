import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist/self-hosted",
    target: "es2022",
    emptyOutDir: true,
    manifest: true,
    license: { fileName: ".vite/licenses.json" },
    rolldownOptions: {
      output: {
        banner: "/*! Third-party licenses: /third-party-licenses.txt */",
      },
    },
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        configure(proxy) {
          // Only the exact local Vite origin is rewritten; foreign/missing origins still fail CSRF checks.
          proxy.on("proxyReq", (outgoing, incoming) => {
            if (incoming.headers.origin === "http://localhost:5173")
              outgoing.setHeader("origin", "http://localhost:3000");
          });
        },
      },
    },
  },
});
