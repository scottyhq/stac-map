import {
  COLORMAP_INDEX,
  createColormapTexture,
  decodeColormapSprite,
  type ColormapName,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapSpriteUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png?url";
import type { Device, Texture } from "@luma.gl/core";
import type { CSSProperties } from "react";
import type { BandRange } from "./single-band";

export { Colormap } from "@developmentseed/deck.gl-raster/gpu-modules";
export type { ColormapName };

/** Every colormap in deck.gl-raster's sprite, in sprite (alphabetical) order. */
export const COLORMAP_NAMES = Object.keys(COLORMAP_INDEX) as ColormapName[];

export function isColormapName(value: unknown): value is ColormapName {
  return typeof value === "string" && Object.hasOwn(COLORMAP_INDEX, value);
}

let spritePromise: Promise<ImageData> | undefined;

function loadColormapSprite(): Promise<ImageData> {
  spritePromise ??= fetch(colormapSpriteUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Colormap sprite: HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then(decodeColormapSprite)
    .catch((error) => {
      // Let a later tile try again.
      spritePromise = undefined;
      throw error;
    });
  return spritePromise;
}

const textureCache = new WeakMap<Device, Promise<Texture | undefined>>();

/**
 * deck.gl-raster's colormap sprite as a GPU texture, for the `Colormap` module.
 * The sprite is fetched once and the texture created once per device, so
 * switching colormaps only changes a uniform. Resolves to undefined if the
 * sprite can't be loaded, in which case tiles fall back to greyscale.
 */
export function getColormapTexture(
  device: Device
): Promise<Texture | undefined> {
  let texture = textureCache.get(device);
  if (!texture) {
    texture = loadColormapSprite().then(
      (sprite) => createColormapTexture(device, sprite),
      (error) => {
        console.warn("Could not load colormaps", error);
        textureCache.delete(device);
        return undefined;
      }
    );
    textureCache.set(device, texture);
  }
  return texture;
}

/**
 * CSS that draws one row of the colormap sprite across an element, for legends
 * and pickers. The element needs a whole-pixel height so rows don't bleed.
 */
export function colormapSwatchStyle(
  name: ColormapName,
  reversed = false
): CSSProperties {
  const count = COLORMAP_NAMES.length;
  return {
    backgroundImage: `url(${colormapSpriteUrl})`,
    backgroundSize: `100% ${count * 100}%`,
    backgroundPosition: `0 ${(COLORMAP_INDEX[name] / (count - 1)) * 100}%`,
    imageRendering: "pixelated",
    transform: reversed ? "scaleX(-1)" : undefined,
  };
}

export type LogRescaleProps = {
  /** Natural log of the value that maps to 0. */
  logMin: number;
  /** Natural log of the value that maps to 1. */
  logMax: number;
};

/**
 * Like `LinearRescale`, but on a log scale: maps `[exp(logMin), exp(logMax)]`
 * to `[0, 1]`, clamping outside it. Values ≤ 0 map to 0.
 */
export const LogRescale = {
  name: "logRescale",
  fs: /* glsl */ `\
uniform logRescaleUniforms {
  float logMin;
  float logMax;
} logRescale;
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color.rgb = clamp(
        (log(max(color.rgb, vec3(1e-30))) - logRescale.logMin) /
          (logRescale.logMax - logRescale.logMin),
        0.0,
        1.0
      );
    `,
  },
  uniformTypes: {
    logMin: "f32",
    logMax: "f32",
  },
  getUniforms: (props: Partial<LogRescaleProps>) => ({
    logMin: props.logMin ?? 0,
    logMax: props.logMax ?? 1,
  }),
} as const;

/** Min, middle and max of the range; the middle is geometric on a log scale. */
export function legendTicks(range: BandRange, log: boolean): number[] {
  const mid = log
    ? Math.sqrt(range.min * range.max)
    : (range.min + range.max) / 2;
  return [range.min, mid, range.max];
}

export function formatValue(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(2);
  return Number(value.toPrecision(4)).toString();
}
