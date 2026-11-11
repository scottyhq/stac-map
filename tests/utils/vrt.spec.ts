import type { StacItem } from "stac-ts";
import { describe, expect, it } from "vitest";
import {
  buildStackVrt,
  getAssetGrid,
  getVrtBands,
  getVrtWindow,
} from "../../src/utils/vrt";

function item(id: string, datetime: string, x0 = 0): StacItem {
  return {
    type: "Feature",
    stac_version: "1.1.0",
    id,
    geometry: null,
    properties: { datetime, "proj:code": "EPSG:3413" },
    links: [],
    assets: {
      data: {
        href: `https://x/${id}.tif`,
        "proj:transform": [10, 0, x0, 0, -10, 1000],
        "proj:shape": [100, 50],
        "raster:bands": [{ data_type: "float32", nodata: -30 }],
      },
    },
  } as StacItem;
}

describe("getAssetGrid", () => {
  it("reads bounds, resolution, type and nodata", () => {
    const a = item("a", "2025-01-01T00:00:00Z");
    expect(getAssetGrid(a, a.assets.data)).toEqual({
      crs: "EPSG:3413",
      bounds: [0, 0, 500, 1000],
      resX: 10,
      resY: 10,
      width: 50,
      height: 100,
      dataType: "Float32",
      nodata: -30,
    });
  });

  it("reads proj:epsg and skips rotated grids", () => {
    const a = item("a", "2025-01-01T00:00:00Z");
    a.properties = { datetime: null, "proj:epsg": 32606 };
    expect(getAssetGrid(a, a.assets.data)?.crs).toBe("EPSG:32606");
    a.assets.data["proj:transform"] = [10, 1, 0, 0, -10, 1000];
    expect(getAssetGrid(a, a.assets.data)).toBeUndefined();
  });
});

describe("getVrtWindow", () => {
  const a = item("a", "2025-01-01T00:00:00Z");
  const grid = getAssetGrid(a, a.assets.data)!;

  it("covers the union of extents", () => {
    expect(getVrtWindow(grid, [grid.bounds, [500, 0, 600, 1000]])).toEqual({
      crs: "EPSG:3413",
      bounds: [0, 0, 600, 1000],
      resX: 10,
      resY: 10,
      width: 60,
      height: 100,
    });
  });

  it("crops and snaps outwards to the pixel grid", () => {
    expect(
      getVrtWindow(grid, [grid.bounds], [101, 203, 255, 409])?.bounds
    ).toEqual([100, 200, 260, 410]);
  });

  it("is undefined when the crop misses", () => {
    expect(
      getVrtWindow(grid, [grid.bounds], [2000, 0, 3000, 10])
    ).toBeUndefined();
  });
});

describe("buildStackVrt", () => {
  it("writes one band per item with source and destination windows", () => {
    const items = [
      item("a", "2025-01-01T00:00:00Z"),
      item("b", "2025-01-13T00:00:00Z", 100),
    ];
    const { bands } = getVrtBands(items, ["data"]);
    const window = getVrtWindow(
      bands[0].grid,
      bands.map((b) => b.grid.bounds),
      [200, 0, 400, 1000]
    )!;
    const xml = buildStackVrt(bands, window);
    expect(xml).toContain('<VRTDataset rasterXSize="20" rasterYSize="100">');
    expect(xml).toContain(
      "<GeoTransform>200, 10, 0, 1000, 0, -10</GeoTransform>"
    );
    expect(xml).toContain("<Description>2025-01-13 data</Description>");
    expect(xml).toContain(
      "/vsicurl?empty_dir=yes&amp;url=https%3A%2F%2Fx%2Fa.tif"
    );
    // a covers x 0–500: the window 200–400 is its columns 20–40.
    expect(xml).toContain(
      '<SrcRect xOff="20" yOff="0" xSize="20" ySize="100" />'
    );
    // b covers x 100–600: the window is its columns 10–30.
    expect(xml).toContain(
      '<SrcRect xOff="10" yOff="0" xSize="20" ySize="100" />'
    );
    expect(xml.match(/<VRTRasterBand/g)).toHaveLength(2);
    expect(xml).toContain("<NoDataValue>-30</NoDataValue>");
  });
});
