import { describe, expect, it } from "vitest";
import {
  COLORMAP_NAMES,
  buildColormapAtlas,
  colormapGradient,
  formatValue,
  getColormapLut,
  isColormapName,
  legendTicks,
} from "../../src/utils/colormap";

describe("colormap LUTs", () => {
  it("decodes every colormap to 256 RGB entries", () => {
    for (const name of COLORMAP_NAMES) {
      expect(getColormapLut(name)).toHaveLength(256 * 3);
    }
  });

  it("matches matplotlib's viridis end colors", () => {
    const lut = getColormapLut("viridis");
    expect([...lut.slice(0, 3)]).toEqual([68, 1, 84]);
    expect([...lut.slice(255 * 3)]).toEqual([253, 231, 37]);
  });

  it("packs one opaque RGBA row per colormap into the atlas", () => {
    const atlas = buildColormapAtlas();
    expect(atlas).toHaveLength(256 * 4 * COLORMAP_NAMES.length);
    const row = COLORMAP_NAMES.indexOf("viridis");
    expect([...atlas.slice(row * 1024, row * 1024 + 4)]).toEqual([
      68, 1, 84, 255,
    ]);
  });

  it("recognises colormap names", () => {
    expect(isColormapName("magma")).toBe(true);
    expect(isColormapName("greyscale")).toBe(false);
    expect(isColormapName(undefined)).toBe(false);
  });
});

describe("colormapGradient", () => {
  it("runs from the first to the last color, or back when reversed", () => {
    expect(colormapGradient("viridis", false, 2)).toBe(
      "linear-gradient(to right, rgb(68, 1, 84), rgb(253, 231, 37))"
    );
    expect(colormapGradient("viridis", true, 2)).toBe(
      "linear-gradient(to right, rgb(253, 231, 37), rgb(68, 1, 84))"
    );
  });
});

describe("legendTicks", () => {
  it("uses the arithmetic middle on a linear scale", () => {
    expect(legendTicks({ min: 0, max: 100 }, false)).toEqual([0, 50, 100]);
  });

  it("uses the geometric middle on a log scale", () => {
    const [, mid] = legendTicks({ min: 1, max: 10000 }, true);
    expect(mid).toBeCloseTo(100);
  });
});

describe("formatValue", () => {
  it("keeps four significant digits", () => {
    expect(formatValue(10507.04296875)).toBe("10510");
    expect(formatValue(0.09864655882120132)).toBe("0.09865");
    expect(formatValue(0)).toBe("0");
  });

  it("switches to exponent notation for very large or small values", () => {
    expect(formatValue(123456)).toBe("1.23e+5");
    expect(formatValue(0.0001234)).toBe("1.23e-4");
  });
});
