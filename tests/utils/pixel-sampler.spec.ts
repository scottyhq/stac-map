import { describe, expect, it } from "vitest";
import {
  formatPixelValue,
  PixelSampler,
  type SampledTile,
  type TiledImage,
} from "../../src/utils/pixel-sampler";

// A north-up image whose CRS coordinates equal lng/lat, with 1-unit pixels and
// its origin at (0, 0); `scale` makes coarser overviews.
function image(width: number, height: number, scale = 1): TiledImage {
  return {
    width,
    height,
    tileWidth: 2,
    tileHeight: 2,
    index: (x: number, y: number) => [
      Math.floor(-y / scale),
      Math.floor(x / scale),
    ],
  };
}

function tile(
  img: TiledImage,
  x: number,
  y: number,
  values: number[],
  width = 2,
  height = 2,
  validMask: Uint8Array | null = null
): SampledTile {
  return {
    image: img,
    x,
    y,
    width,
    height,
    values: Float32Array.from(values),
    validMask,
  };
}

const identity = (x: number, y: number): [number, number] => [x, y];

describe("PixelSampler", () => {
  it("reads the value at a point from a loaded tile", () => {
    const full = image(4, 4);
    const sampler = new PixelSampler([full], identity, null);
    sampler.add(tile(full, 1, 0, [10, 11, 12, 13]));
    // col 3 → tile x 1, in-tile col 1; row 1 → in-tile row 1
    expect(sampler.sample(3.5, -1.5)).toEqual({ value: 13, level: 0 });
  });

  it("returns null where no tile is loaded", () => {
    const full = image(4, 4);
    const sampler = new PixelSampler([full], identity, null);
    sampler.add(tile(full, 0, 0, [1, 2, 3, 4]));
    expect(sampler.sample(3.5, -3.5)).toBeNull();
  });

  it("returns null outside the image", () => {
    const full = image(4, 4);
    const sampler = new PixelSampler([full], identity, null);
    sampler.add(tile(full, 0, 0, [1, 2, 3, 4]));
    expect(sampler.sample(-1, -1)).toBeNull();
  });

  it("falls back to a coarser overview and reports its level", () => {
    const full = image(4, 4);
    const overview = image(2, 2, 2);
    const sampler = new PixelSampler([full, overview], identity, null);
    sampler.add(tile(overview, 0, 0, [5, 6, 7, 8]));
    expect(sampler.sample(3.5, -3.5)).toEqual({ value: 8, level: 1 });
    sampler.add(tile(full, 1, 1, [20, 21, 22, 23]));
    expect(sampler.sample(3.5, -3.5)).toEqual({ value: 23, level: 0 });
  });

  it("uses the clipped width of edge tiles", () => {
    const full = image(3, 2);
    const sampler = new PixelSampler([full], identity, null);
    // The right-hand tile is one pixel wide.
    sampler.add(tile(full, 1, 0, [30, 31], 1, 2));
    expect(sampler.sample(2.5, -1.5)).toEqual({ value: 31, level: 0 });
  });

  it("skips nodata, masked, and NaN pixels", () => {
    const full = image(2, 2);
    const sampler = new PixelSampler([full], identity, -9999);
    sampler.add(
      tile(full, 0, 0, [-9999, NaN, 3, 4], 2, 2, Uint8Array.from([1, 1, 0, 1]))
    );
    expect(sampler.sample(0.5, -0.5)).toBeNull();
    expect(sampler.sample(1.5, -0.5)).toBeNull();
    expect(sampler.sample(0.5, -1.5)).toBeNull();
    expect(sampler.sample(1.5, -1.5)).toEqual({ value: 4, level: 0 });
  });

  it("forgets unloaded tiles, but not a newer tile at the same index", () => {
    const full = image(2, 2);
    const sampler = new PixelSampler([full], identity, null);
    const first = tile(full, 0, 0, [1, 1, 1, 1]);
    const second = tile(full, 0, 0, [2, 2, 2, 2]);
    sampler.add(first);
    sampler.add(second);
    sampler.remove(first);
    expect(sampler.sample(0.5, -0.5)?.value).toBe(2);
    sampler.remove(second);
    expect(sampler.sample(0.5, -0.5)).toBeNull();
  });

  it("samples once a pending projection resolves", async () => {
    const full = image(2, 2);
    const projection = Promise.resolve(identity);
    const sampler = new PixelSampler([full], projection, null);
    sampler.add(tile(full, 0, 0, [7, 7, 7, 7]));
    expect(sampler.sample(0.5, -0.5)).toBeNull();
    await projection;
    expect(sampler.sample(0.5, -0.5)?.value).toBe(7);
  });
});

describe("formatPixelValue", () => {
  it("keeps integers and trims floats", () => {
    expect(formatPixelValue(42)).toBe("42");
    expect(formatPixelValue(0.123456789)).toBe("0.123457");
  });
});
