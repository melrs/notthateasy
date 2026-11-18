import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "privacy-headers",
      transformIndexHtml:
        command === "build"
          ? (html) =>
              html.replace(
                "<head>",
                `<head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">`,
              )
          : undefined,
    },
  ],
  base: process.env.VITE_BASE_PATH || "./",
  build: { sourcemap: false },
}));
