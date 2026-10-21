import { defineConfig } from "vite";

/** Slug = folder name under apps/ → Vite base `/<slug>/` for the combined Worker. */
const slug = "banked-curve";

export default defineConfig({
  base: `/${slug}/`,
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 43134,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 43134,
    strictPort: true,
  },
});
