import { describe, expect, it } from "vitest";
import {
  bboxesIntersect,
  clampToGlobalExtents,
  resolveInitialBbox,
} from "../../src/utils/bbox";

describe("resolveInitialBbox", () => {
  it("returns the parsed bbox for a valid bbox param", () => {
    expect(resolveInitialBbox("?bbox=-180,-90,180,90")).toEqual([
      -180, -90, 180, 90,
    ]);
  });

  it("supports decimals", () => {
    expect(resolveInitialBbox("?bbox=-1.5,2.25,3,4.75")).toEqual([
      -1.5, 2.25, 3, 4.75,
    ]);
  });

  it("returns null when the bbox param is absent", () => {
    expect(resolveInitialBbox("?href=foo")).toBeNull();
  });

  it("returns null for an empty search string", () => {
    expect(resolveInitialBbox("")).toBeNull();
  });

  it("returns null for fewer than four values", () => {
    expect(resolveInitialBbox("?bbox=1,2,3")).toBeNull();
  });

  it("returns null for more than four values", () => {
    expect(resolveInitialBbox("?bbox=1,2,3,4,5")).toBeNull();
  });

  it("returns null when any value is not a number", () => {
    expect(resolveInitialBbox("?bbox=1,2,3,foo")).toBeNull();
  });

  it("reads alongside other params", () => {
    expect(
      resolveInitialBbox("?href=https://example.com/c.json&bbox=-10,-20,10,20")
    ).toEqual([-10, -20, 10, 20]);
  });
});

describe("clampToGlobalExtents", () => {
  it("leaves a bbox within global extents unchanged", () => {
    expect(clampToGlobalExtents([-10, -20, 10, 20])).toEqual([
      -10, -20, 10, 20,
    ]);
  });

  it("clamps a west edge beyond -180", () => {
    expect(clampToGlobalExtents([-300, -20, 10, 20])).toEqual([
      -180, -20, 10, 20,
    ]);
  });

  it("clamps an east edge beyond 180", () => {
    expect(clampToGlobalExtents([-10, -20, 400, 20])).toEqual([
      -10, -20, 180, 20,
    ]);
  });

  it("clamps a south edge beyond -90", () => {
    expect(clampToGlobalExtents([-10, -150, 10, 20])).toEqual([
      -10, -90, 10, 20,
    ]);
  });

  it("clamps a north edge beyond 90", () => {
    expect(clampToGlobalExtents([-10, -20, 10, 150])).toEqual([
      -10, -20, 10, 90,
    ]);
  });

  it("clamps all four edges at once", () => {
    expect(clampToGlobalExtents([-300, -150, 400, 150])).toEqual([
      -180, -90, 180, 90,
    ]);
  });
});

describe("bboxesIntersect", () => {
  it("is true for overlapping boxes", () => {
    expect(bboxesIntersect([0, 0, 10, 10], [5, 5, 15, 15])).toBe(true);
  });

  it("is true when one box contains the other", () => {
    expect(bboxesIntersect([0, 0, 10, 10], [2, 2, 3, 3])).toBe(true);
  });

  it("is false for disjoint boxes", () => {
    expect(bboxesIntersect([0, 0, 10, 10], [20, 0, 30, 10])).toBe(false);
    expect(bboxesIntersect([0, 0, 10, 10], [0, 20, 10, 30])).toBe(false);
  });

  it("is true for a box spanning the globe", () => {
    expect(bboxesIntersect([-180, -90, 180, 90], [20, 0, 30, 10])).toBe(true);
  });
});
