import { describe, expect, it } from "vitest";
import {
  buildDuckdbCommand,
  buildRustacCommand,
  buildStacAssetCommand,
  clampBbox,
  downloadFilterToWhere,
  shellQuote,
  toGdalPath,
  toUrlList,
  visualizedAssetKey,
} from "../../src/utils/download-items";

const start = Date.parse("2025-01-01T00:00:00Z");
const end = Date.parse("2025-02-01T00:00:00Z");

describe("downloadFilterToWhere", () => {
  it("is undefined with no filter", () => {
    expect(downloadFilterToWhere({})).toBeUndefined();
  });

  it("combines datetime and bbox", () => {
    expect(
      downloadFilterToWhere({
        datetime: [start, end],
        bbox: [-50, 60, -40, 70],
      })
    ).toBe(
      "datetime BETWEEN TIMESTAMP '2025-01-01T00:00:00.000Z' AND TIMESTAMP '2025-02-01T00:00:00.000Z' AND ST_Intersects(geometry, ST_MakeEnvelope(-50, 60, -40, 70))"
    );
  });
});

describe("clampBbox", () => {
  it("clamps a wrapped map view", () => {
    expect(clampBbox([-200, -95, 190, 80])).toEqual([-180, -90, 180, 80]);
  });
});

describe("shellQuote", () => {
  it("escapes single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("toUrlList", () => {
  it("joins hrefs with a trailing newline", () => {
    expect(
      toUrlList([
        { id: "a", assetKey: "data", href: "https://x/a.tif" },
        { id: "b", assetKey: "data", href: "https://x/b.tif" },
      ])
    ).toBe("https://x/a.tif\nhttps://x/b.tif\n");
    expect(toUrlList([])).toBe("");
  });
});

describe("buildDuckdbCommand", () => {
  it("selects each asset href with the filter", () => {
    const command = buildDuckdbCommand({
      href: "https://example.com/items.parquet",
      assetKeys: ["data", "B-04"],
      filter: { datetime: [start, end] },
    });
    expect(command).toContain(`unnest([assets.data.href, assets."B-04".href])`);
    expect(command).toContain(
      "FROM read_parquet('https://example.com/items.parquet')"
    );
    expect(command).toContain("WHERE datetime BETWEEN");
    expect(command).not.toContain("spatial");
    expect(
      command.startsWith("duckdb -noheader -list > urls.txt <<'SQL'\n")
    ).toBe(true);
    expect(command.endsWith("\nSQL")).toBe(true);
  });

  it("loads spatial for a bbox", () => {
    const command = buildDuckdbCommand({
      href: "items.parquet",
      assetKeys: ["data"],
      filter: { bbox: [0, 0, 1, 1] },
    });
    expect(command).toContain("LOAD spatial;");
    expect(command).toContain("ST_MakeEnvelope(0, 0, 1, 1)");
  });
});

describe("buildRustacCommand", () => {
  it("passes datetime and bbox and extracts hrefs with jq", () => {
    expect(
      buildRustacCommand({
        href: "https://example.com/items.parquet",
        assetKeys: ["data", "thumbnail"],
        filter: { datetime: [start, end], bbox: [-50, 60, -40, 70] },
      })
    ).toBe(
      "rustac search 'https://example.com/items.parquet' --datetime='2025-01-01T00:00:00.000Z/2025-02-01T00:00:00.000Z' --bbox='-50,60,-40,70' \\\n" +
        `  | jq -r '.features[] | (.assets["data"].href, .assets["thumbnail"].href) | values' > urls.txt`
    );
  });
});

describe("visualizedAssetKey", () => {
  it("strips the prefix and checks membership", () => {
    expect(visualizedAssetKey("items:data", ["data"])).toBe("data");
    expect(visualizedAssetKey("asset:data", ["data"])).toBe("data");
    expect(visualizedAssetKey("tilejson", ["data"])).toBeUndefined();
    expect(visualizedAssetKey(null, ["data"])).toBeUndefined();
  });
});

describe("toGdalPath", () => {
  it("maps schemes to GDAL virtual file systems", () => {
    expect(toGdalPath("https://x/a b.tif")).toBe(
      "/vsicurl?empty_dir=yes&url=https%3A%2F%2Fx%2Fa%20b.tif"
    );
    expect(toGdalPath("s3://bucket/a.parquet")).toBe("/vsis3/bucket/a.parquet");
    expect(toGdalPath("a.parquet")).toBe("a.parquet");
  });
});

describe("buildStacAssetCommand", () => {
  it("pipes rustac search into stac-asset download", () => {
    expect(
      buildStacAssetCommand({
        href: "https://x/a.parquet",
        assetKeys: ["gamma0", "sigma0"],
        filter: {},
      })
    ).toBe(
      "rustac search 'https://x/a.parquet' \\\n  | stac-asset download -i 'gamma0' -i 'sigma0' - 'items'"
    );
  });
});
