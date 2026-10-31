import { describe, expect, it } from "vitest";
import { datetimeFilterToWhere } from "../../src/utils/stac-geoparquet";

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
