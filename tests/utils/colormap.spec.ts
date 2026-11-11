import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import { describe, expect, it } from "vitest";
import {
  COLORMAP_NAMES,
  colormapSwatchStyle,
  formatValue,
  isColormapName,
  legendTicks,
} from "../../src/utils/colormap";

describe("colormap names", () => {
  it("lists every colormap in deck.gl-raster's sprite, in sprite order", () => {
    expect(COLORMAP_NAMES).toHaveLength(Object.keys(COLORMAP_INDEX).length);
    COLORMAP_NAMES.forEach((name, i) => expect(COLORMAP_INDEX[name]).toBe(i));
  });

  it("still includes the colormaps offered before", () => {
    for (const name of [
      "viridis",
      "plasma",
      "inferno",
      "magma",
      "cividis",
      "turbo",
      "terrain",
      "coolwarm",
      "rdbu",
      "spectral",
      "ylgnbu",
    ]) {
      expect(isColormapName(name)).toBe(true);
    }
  });

  it("recognises colormap names", () => {
    expect(isColormapName("ice")).toBe(true);
    expect(isColormapName("greyscale")).toBe(false);
    expect(isColormapName("toString")).toBe(false);
    expect(isColormapName(undefined)).toBe(false);
  });
});

describe("colormapSwatchStyle", () => {
  const count = COLORMAP_NAMES.length;

  it("shows the colormap's row of the sprite", () => {
    expect(colormapSwatchStyle(COLORMAP_NAMES[0]).backgroundPosition).toBe(
      "0 0%"
    );
    expect(
      colormapSwatchStyle(COLORMAP_NAMES[count - 1]).backgroundPosition
    ).toBe("0 100%");
    expect(colormapSwatchStyle("viridis").backgroundSize).toBe(
      `100% ${count * 100}%`
    );
  });

  it("mirrors the swatch when reversed", () => {
    expect(colormapSwatchStyle("viridis").transform).toBeUndefined();
    expect(colormapSwatchStyle("viridis", true).transform).toBe("scaleX(-1)");
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
