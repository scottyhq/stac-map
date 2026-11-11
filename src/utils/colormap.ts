import type { Device, Texture } from "@luma.gl/core";
import { COLORMAP_LUTS } from "./colormap-luts";
import type { BandRange } from "./single-band";

export type ColormapName = keyof typeof COLORMAP_LUTS;

export const COLORMAP_NAMES = Object.keys(COLORMAP_LUTS) as ColormapName[];

const LUT_SIZE = 256;

export function isColormapName(value: unknown): value is ColormapName {
  return typeof value === "string" && value in COLORMAP_LUTS;
}

const lutCache = new Map<ColormapName, Uint8Array>();

/** The 256 RGB entries of a colormap, as 768 bytes. */
export function getColormapLut(name: ColormapName): Uint8Array {
  let lut = lutCache.get(name);
  if (!lut) {
    const binary = atob(COLORMAP_LUTS[name]);
    lut = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) lut[i] = binary.charCodeAt(i);
    lutCache.set(name, lut);
  }
  return lut;
}

/**
 * All colormaps packed into one RGBA image, 256 pixels wide with one row per
 * colormap, in {@link COLORMAP_NAMES} order.
 */
export function buildColormapAtlas(): Uint8Array {
  const atlas = new Uint8Array(LUT_SIZE * COLORMAP_NAMES.length * 4);
  COLORMAP_NAMES.forEach((name, row) => {
    const lut = getColormapLut(name);
    for (let i = 0; i < LUT_SIZE; i++) {
      const offset = (row * LUT_SIZE + i) * 4;
      atlas[offset] = lut[i * 3];
      atlas[offset + 1] = lut[i * 3 + 1];
      atlas[offset + 2] = lut[i * 3 + 2];
      atlas[offset + 3] = 255;
    }
  });
  return atlas;
}

const textureCache = new WeakMap<Device, Texture>();

/**
 * The colormap atlas as a GPU texture. Created once per device and shared by
 * every tile, so switching colormaps only changes a uniform.
 */
export function getColormapTexture(device: Device): Texture {
  let texture = textureCache.get(device);
  if (!texture) {
    texture = device.createTexture({
      data: buildColormapAtlas(),
      format: "rgba8unorm",
      width: LUT_SIZE,
      height: COLORMAP_NAMES.length,
      sampler: {
        minFilter: "linear",
        magFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });
    textureCache.set(device, texture);
  }
  return texture;
}

/** A CSS `linear-gradient` that previews a colormap, for legends and pickers. */
export function colormapGradient(
  name: ColormapName,
  reversed = false,
  stops = 16
): string {
  const lut = getColormapLut(name);
  const colors: string[] = [];
  for (let s = 0; s < stops; s++) {
    const t = s / (stops - 1);
    const i = Math.round((reversed ? 1 - t : t) * (LUT_SIZE - 1));
    colors.push(`rgb(${lut[i * 3]}, ${lut[i * 3 + 1]}, ${lut[i * 3 + 2]})`);
  }
  return `linear-gradient(to right, ${colors.join(", ")})`;
}

export type ColormapProps = {
  colormapTexture: Texture;
  colormapIndex: number;
  colormapCount: number;
  reversed: boolean;
};

/**
 * A shader module that maps the normalized value in `color.r` (0–1) through
 * one row of the colormap atlas from {@link getColormapTexture}.
 */
export const Colormap = {
  name: "colormap",
  fs: /* glsl */ `\
uniform colormapUniforms {
  float colormapIndex;
  float colormapCount;
  float reversed;
} colormap;
`,
  inject: {
    "fs:#decl": `uniform sampler2D colormapTexture;`,
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float colormapT = clamp(color.r, 0.0, 1.0);
      colormapT = mix(colormapT, 1.0 - colormapT, colormap.reversed);
      // Sample texel centres so 0 and 1 land exactly on the end colors.
      vec2 colormapUv = vec2(
        (colormapT * ${LUT_SIZE - 1}.0 + 0.5) / ${LUT_SIZE}.0,
        (colormap.colormapIndex + 0.5) / colormap.colormapCount
      );
      color.rgb = texture(colormapTexture, colormapUv).rgb;
    `,
  },
  uniformTypes: {
    colormapIndex: "f32",
    colormapCount: "f32",
    reversed: "f32",
  },
  getUniforms: (props: Partial<ColormapProps>) => ({
    colormapTexture: props.colormapTexture,
    colormapIndex: props.colormapIndex ?? 0,
    colormapCount: props.colormapCount ?? COLORMAP_NAMES.length,
    reversed: props.reversed ? 1 : 0,
  }),
} as const;

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
