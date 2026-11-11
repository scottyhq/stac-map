import { describe, expect, it } from "vitest";
import {
  datetimeFilterToWhere,
  getAdjacentTimelineIds,
} from "../../src/utils/stac-geoparquet";

describe("datetimeFilterToWhere", () => {
  it("returns undefined without a filter", () => {
    expect(datetimeFilterToWhere(undefined)).toBeUndefined();
  });

  it("builds a BETWEEN clause on datetime", () => {
    const start = Date.parse("2025-12-01T00:00:00Z");
    const end = Date.parse("2025-12-20T00:00:00Z");
    expect(datetimeFilterToWhere([start, end])).toBe(
      "datetime BETWEEN TIMESTAMP '2025-12-01T00:00:00.000Z' AND TIMESTAMP '2025-12-20T00:00:00.000Z'"
    );
  });

  it("uses a custom column", () => {
    const ms = Date.parse("2025-12-01T00:00:00Z");
    expect(datetimeFilterToWhere([ms, ms], "other.datetime")).toMatch(
      /^other\.datetime BETWEEN /
    );
  });
});

describe("getAdjacentTimelineIds", () => {
  const timeline = [
    { id: "a", datetime: 1 },
    { id: "b", datetime: 2 },
    { id: "c", datetime: 3 },
    { id: "d", datetime: 4 },
  ];

  it("returns the neighbours in time", () => {
    expect(getAdjacentTimelineIds(timeline, "b")).toEqual({
      previous: "a",
      next: "c",
    });
  });

  it("returns null at the ends", () => {
    expect(getAdjacentTimelineIds(timeline, "a").previous).toBeNull();
    expect(getAdjacentTimelineIds(timeline, "d").next).toBeNull();
  });

  it("skips entries outside the datetime filter", () => {
    expect(getAdjacentTimelineIds(timeline, "b", [2, 2])).toEqual({
      previous: null,
      next: null,
    });
    expect(getAdjacentTimelineIds(timeline, "a", [3, 4]).next).toBe("c");
  });

  it("steps back into the filter from an item outside it", () => {
    expect(getAdjacentTimelineIds(timeline, "d", [1, 2]).previous).toBe("b");
  });

  it("returns nulls for an id not in the timeline", () => {
    expect(getAdjacentTimelineIds(timeline, "z")).toEqual({
      previous: null,
      next: null,
    });
  });
});
