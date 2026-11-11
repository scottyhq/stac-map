import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import wasm from "vite-plugin-wasm";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8")
);

const externalNames = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

const externalRegex = new RegExp(
  `^(${externalNames
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(/.*)?$`
);

export default defineConfig({
  publicDir: false,
  build: {
    target: "esnext",
    cssCodeSplit: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/lib.ts"),
      formats: ["es"],
      fileName: () => "lib.js",
      cssFileName: "style",
    },
    rollupOptions: {
      // Bundle CSS, and inline assets such as deck.gl-raster's colormap sprite
      // so apps embedding stac-map don't need an asset loader for them.
      external: (id) =>
        /\.(css|png)(\?|$)/.test(id) ? false : externalRegex.test(id),
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  worker: {
    format: "es",
  },
  plugins: [
    react(),
    wasm(),
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      bundleTypes: true,
    }),
  ],
});
