import { describe, expect, it } from "vitest";
import {
  colorBarTicks,
  formatDistance,
  formatPowerOfTen,
  getVideoSize,
  MAX_VIDEO_SIZE,
  niceScaleLength,
} from "../../src/utils/animation";

describe("getVideoSize", () => {
  it("uses device pixels, rounded down to even numbers", () => {
    expect(getVideoSize(641, 481, 1)).toEqual({ width: 640, height: 480 });
    expect(getVideoSize(640, 400, 2)).toEqual({ width: 1280, height: 800 });
  });

  it("caps the longest side", () => {
    const size = getVideoSize(1600, 900, 2);
    expect(size.width).toBe(MAX_VIDEO_SIZE);
    expect(size.height).toBe(1080);
  });
});

describe("niceScaleLength", () => {
  it("rounds down to 1, 2 or 5 × 10ⁿ", () => {
    expect(niceScaleLength(23_456)).toBe(20_000);
    expect(niceScaleLength(7_100)).toBe(5_000);
    expect(niceScaleLength(1_999)).toBe(1_000);
    expect(niceScaleLength(0.8)).toBe(0.5);
    expect(niceScaleLength(0)).toBe(0);
  });
});

describe("formatDistance", () => {
  it("uses km from 1000 m", () => {
    expect(formatDistance(500)).toBe("500 m");
    expect(formatDistance(20_000)).toBe("20 km");
  });
});

describe("colorBarTicks", () => {
  const labels = (range: { min: number; max: number }, log = false) =>
    colorBarTicks(range, log).map((t) => t.label);

  it("uses round 1/2/5 × 10ⁿ steps on a linear scale", () => {
    expect(labels({ min: -27.24, max: 2.567 })).toEqual(["-20", "-10", "0"]);
    expect(labels({ min: 0, max: 3000 })).toEqual([
      "0",
      "1000",
      "2000",
      "3000",
    ]);
    expect(labels({ min: 0.12, max: 0.87 })).toEqual([
      "0.2",
      "0.4",
      "0.6",
      "0.8",
    ]);
  });

  it("places ticks by value", () => {
    const ticks = colorBarTicks({ min: -30, max: 10 }, false);
    expect(ticks.map((t) => t.value)).toEqual([-20, 0]);
    expect(ticks.map((t) => t.position)).toEqual([0.25, 0.75]);
  });

  it("uses powers of ten on a log scale", () => {
    expect(labels({ min: 0.5, max: 5000 }, true)).toEqual([
      "1",
      "10",
      "100",
      "1k",
    ]);
    const ticks = colorBarTicks({ min: 1, max: 100 }, true);
    expect(ticks.map((t) => t.position)).toEqual([0, 0.5, 1]);
  });

  it("thins out decades to at most 4", () => {
    expect(labels({ min: 1e-3, max: 1e6 }, true)).toEqual([
      "0.001",
      "1",
      "1k",
      "1M",
    ]);
  });

  it("falls back to min and max when fewer than 2 round values fit", () => {
    expect(labels({ min: 2, max: 9 }, true)).toEqual(["2", "9"]);
    expect(labels({ min: 5, max: 5 })).toEqual(["5", "5"]);
  });
});

describe("formatPowerOfTen", () => {
  it("uses short forms", () => {
    expect(formatPowerOfTen(-2)).toBe("0.01");
    expect(formatPowerOfTen(0)).toBe("1");
    expect(formatPowerOfTen(4)).toBe("10k");
    expect(formatPowerOfTen(6)).toBe("1M");
    expect(formatPowerOfTen(-5)).toBe("1e-5");
  });
});
