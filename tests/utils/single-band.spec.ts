import { Photometric } from "@cogeotiff/core";
import {
  BlackIsZero,
  CreateTexture,
  FilterNoDataVal,
  LinearRescale,
  MaskTexture,
  WhiteIsZero,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF } from "@developmentseed/geotiff";
import type { StacAsset } from "stac-ts";
import { describe, expect, it } from "vitest";
import { Colormap, LogRescale } from "../../src/utils/colormap";
import {
  accumulateMinMax,
  getStacBandStatistics,
  getStacBandUnit,
  getStoredBandStatistics,
  logScaleRange,
  renderTileTriggers,
  resolveBandRange,
  singleBandPipeline,
  type SingleBandTileData,
} from "../../src/utils/single-band";

function asset(extra: Record<string, unknown>): StacAsset {
  return { href: "https://example.com/cog.tif", ...extra } as StacAsset;
}

function geotiff(storedStats: unknown): GeoTIFF {
  return { storedStats } as unknown as GeoTIFF;
}

describe("getStacBandStatistics", () => {
  it("reads minimum and maximum from raster:bands", () => {
    expect(
      getStacBandStatistics(
        asset({
          "raster:bands": [{ statistics: { minimum: 10, maximum: 250 } }],
        })
      )
    ).toEqual({ min: 10, max: 250 });
  });

  it("returns undefined when raster:bands is absent", () => {
    expect(getStacBandStatistics(asset({}))).toBeUndefined();
  });

  it("returns undefined when statistics are non-finite", () => {
    expect(
      getStacBandStatistics(
        asset({
          "raster:bands": [{ statistics: { minimum: null, maximum: 5 } }],
        })
      )
    ).toBeUndefined();
  });
});

describe("getStacBandStatistics (STAC 1.1 bands)", () => {
  it("reads statistics from bands", () => {
    expect(
      getStacBandStatistics(
        asset({ bands: [{ statistics: { minimum: -30, maximum: 5 } }] })
      )
    ).toEqual({ min: -30, max: 5 });
  });
});

describe("getStacBandUnit", () => {
  it("reads the unit from bands or raster:bands", () => {
    expect(getStacBandUnit(asset({ bands: [{ unit: "dB" }] }))).toBe("dB");
    expect(
      getStacBandUnit(asset({ "raster:bands": [{ unit: "m/yr" }] }))
    ).toBe("m/yr");
  });

  it("returns undefined when there's no unit", () => {
    expect(getStacBandUnit(asset({}))).toBeUndefined();
    expect(getStacBandUnit(asset({ bands: [{ unit: " " }] }))).toBeUndefined();
  });
});

describe("getStoredBandStatistics", () => {
  it("reads band 1 stats from the geotiff's stored GDAL metadata", () => {
    const stats = new Map([
      [1, { min: 0, max: 100, mean: null, std: null, validPercent: null }],
    ]);
    expect(getStoredBandStatistics(geotiff(stats))).toEqual({
      min: 0,
      max: 100,
    });
  });

  it("returns undefined when no stored stats exist", () => {
    expect(getStoredBandStatistics(geotiff(null))).toBeUndefined();
  });

  it("returns undefined when band 1 min/max are null", () => {
    const stats = new Map([
      [1, { min: null, max: null, mean: null, std: null, validPercent: null }],
    ]);
    expect(getStoredBandStatistics(geotiff(stats))).toBeUndefined();
  });
});

describe("resolveBandRange", () => {
  it("prefers STAC statistics over stored stats", () => {
    const stats = new Map([
      [1, { min: 0, max: 100, mean: null, std: null, validPercent: null }],
    ]);
    expect(
      resolveBandRange(
        asset({ "raster:bands": [{ statistics: { minimum: 1, maximum: 9 } }] }),
        geotiff(stats)
      )
    ).toEqual({ min: 1, max: 9 });
  });

  it("falls back to stored stats when STAC has none", () => {
    const stats = new Map([
      [1, { min: 3, max: 7, mean: null, std: null, validPercent: null }],
    ]);
    expect(resolveBandRange(asset({}), geotiff(stats))).toEqual({
      min: 3,
      max: 7,
    });
  });

  it("returns undefined when neither source has stats", () => {
    expect(resolveBandRange(asset({}), geotiff(null))).toBeUndefined();
  });
});

function tiff(cachedPrimaryImageTags: Record<string, unknown>): GeoTIFF {
  return { cachedPrimaryImageTags } as unknown as GeoTIFF;
}

describe("singleBandPipeline", () => {
  it("returns a getTileData + renderTile pair for single-band MinIsBlack", () => {
    const pipeline = singleBandPipeline(
      tiff({
        samplesPerPixel: 1,
        photometric: Photometric.MinIsBlack,
        nodata: null,
      }),
      { min: 0, max: 255 }
    );
    expect(pipeline?.getTileData).toBeTypeOf("function");
    expect(pipeline?.renderTile).toBeTypeOf("function");
  });

  it("returns undefined for palette single-band", () => {
    expect(
      singleBandPipeline(
        tiff({
          samplesPerPixel: 1,
          photometric: Photometric.Palette,
          nodata: null,
        }),
        undefined
      )
    ).toBeUndefined();
  });

  it("returns undefined for 3-band imagery", () => {
    expect(
      singleBandPipeline(
        tiff({
          samplesPerPixel: 3,
          photometric: Photometric.Rgb,
          nodata: null,
        }),
        undefined
      )
    ).toBeUndefined();
  });

  it("returns undefined for 4-band imagery", () => {
    expect(
      singleBandPipeline(
        tiff({
          samplesPerPixel: 4,
          photometric: Photometric.Rgb,
          nodata: null,
        }),
        undefined
      )
    ).toBeUndefined();
  });
});

function tileData(extra: Partial<SingleBandTileData>): SingleBandTileData {
  return { texture: {}, width: 1, height: 1, byteLength: 4, ...extra } as never;
}

describe("singleBandPipeline renderTile", () => {
  it("wires CreateTexture, LinearRescale, BlackIsZero for a plain single band", () => {
    const pipeline = singleBandPipeline(
      tiff({
        samplesPerPixel: 1,
        photometric: Photometric.MinIsBlack,
        nodata: null,
      }),
      { min: 5, max: 200 }
    );
    const { renderPipeline } = pipeline!.renderTile(tileData({}))!;
    expect(renderPipeline.map((step) => step.module)).toEqual([
      CreateTexture,
      LinearRescale,
      BlackIsZero,
    ]);
    expect(renderPipeline[1].props).toEqual({ rescaleMin: 5, rescaleMax: 200 });
  });

  it("inserts FilterNoDataVal and MaskTexture in order when present", () => {
    const pipeline = singleBandPipeline(
      tiff({
        samplesPerPixel: 1,
        photometric: Photometric.MinIsBlack,
        nodata: -9999,
      }),
      { min: 0, max: 255 }
    );
    const { renderPipeline } = pipeline!.renderTile(
      tileData({ mask: {} as never })
    )!;
    expect(renderPipeline.map((step) => step.module)).toEqual([
      CreateTexture,
      FilterNoDataVal,
      MaskTexture,
      LinearRescale,
      BlackIsZero,
    ]);
    expect(renderPipeline[1].props).toEqual({ value: -9999 });
  });

  it("omits LinearRescale when range is undefined", () => {
    const pipeline = singleBandPipeline(
      tiff({
        samplesPerPixel: 1,
        photometric: Photometric.MinIsBlack,
        nodata: null,
      }),
      undefined
    );
    const { renderPipeline } = pipeline!.renderTile(tileData({}))!;
    expect(renderPipeline.map((step) => step.module)).toEqual([
      CreateTexture,
      BlackIsZero,
    ]);
  });

  it("terminates with WhiteIsZero for MinIsWhite photometric", () => {
    const pipeline = singleBandPipeline(
      tiff({
        samplesPerPixel: 1,
        photometric: Photometric.MinIsWhite,
        nodata: null,
      }),
      { min: 0, max: 1 }
    );
    const { renderPipeline } = pipeline!.renderTile(tileData({}))!;
    expect(renderPipeline.at(-1)!.module).toBe(WhiteIsZero);
    expect(renderPipeline.map((step) => step.module)).not.toContain(
      BlackIsZero
    );
  });
});

describe("accumulateMinMax", () => {
  it("tracks the min and max across values", () => {
    const acc = { min: Infinity, max: -Infinity };
    accumulateMinMax(acc, [5, 1, 9, 3], null, null);
    expect(acc).toEqual({ min: 1, max: 9 });
  });

  it("skips masked-out (0) pixels", () => {
    const acc = { min: Infinity, max: -Infinity };
    accumulateMinMax(acc, [5, 1, 9, 3], new Uint8Array([255, 0, 0, 255]), null);
    expect(acc).toEqual({ min: 3, max: 5 });
  });

  it("skips nodata values", () => {
    const acc = { min: Infinity, max: -Infinity };
    accumulateMinMax(acc, [5, -9999, 9, 3], null, -9999);
    expect(acc).toEqual({ min: 3, max: 9 });
  });

  it("skips non-finite values", () => {
    const acc = { min: Infinity, max: -Infinity };
    accumulateMinMax(acc, [5, NaN, 9, Infinity], null, null);
    expect(acc).toEqual({ min: 5, max: 9 });
  });
});

describe("singleBandPipeline with a style", () => {
  const plain = () =>
    tiff({
      samplesPerPixel: 1,
      photometric: Photometric.MinIsBlack,
      nodata: null,
    });
  const colormapTexture = { id: "colormap" };

  it("ends with Colormap instead of BlackIsZero when a colormap is set", () => {
    const pipeline = singleBandPipeline(
      plain(),
      { min: 0, max: 10 },
      { colormap: "magma", reversed: true, scale: "linear" }
    );
    const { renderPipeline } = pipeline!.renderTile(
      tileData({ colormapTexture } as never)
    )!;
    expect(renderPipeline.map((step) => step.module)).toEqual([
      CreateTexture,
      LinearRescale,
      Colormap,
    ]);
    expect(renderPipeline[2].props).toMatchObject({
      colormapTexture,
      reversed: true,
    });
    expect(renderPipeline[2].props!.colormapIndex).toBeGreaterThanOrEqual(0);
  });

  it("uses LogRescale with natural-log bounds on a log scale", () => {
    const pipeline = singleBandPipeline(
      plain(),
      { min: 0.1, max: 10000 },
      { colormap: null, reversed: false, scale: "log" }
    );
    const { renderPipeline } = pipeline!.renderTile(tileData({}))!;
    expect(renderPipeline[1].module).toBe(LogRescale);
    expect(renderPipeline[1].props!.logMin).toBeCloseTo(Math.log(0.1));
    expect(renderPipeline[1].props!.logMax).toBeCloseTo(Math.log(10000));
  });

  it("falls back to LinearRescale on a log scale when max <= 0", () => {
    const pipeline = singleBandPipeline(
      plain(),
      { min: -10, max: 0 },
      { colormap: null, reversed: false, scale: "log" }
    );
    const { renderPipeline } = pipeline!.renderTile(tileData({}))!;
    expect(renderPipeline[1].module).toBe(LinearRescale);
  });

  it("swaps greyscale direction when reversed without a colormap", () => {
    const pipeline = singleBandPipeline(
      plain(),
      { min: 0, max: 1 },
      { colormap: null, reversed: true, scale: "linear" }
    );
    const { renderPipeline } = pipeline!.renderTile(tileData({}))!;
    expect(renderPipeline.at(-1)!.module).toBe(WhiteIsZero);
  });
});

describe("logScaleRange", () => {
  it("keeps a positive range", () => {
    expect(logScaleRange({ min: 0.1, max: 100 })).toEqual({
      min: 0.1,
      max: 100,
    });
  });

  it("raises a min <= 0 to three decades below max", () => {
    expect(logScaleRange({ min: 0, max: 5000 })).toEqual({ min: 5, max: 5000 });
  });

  it("returns undefined when max <= 0", () => {
    expect(logScaleRange({ min: -5, max: 0 })).toBeUndefined();
  });
});

describe("renderTileTriggers", () => {
  it("changes when the style or range changes", () => {
    const style = { colormap: null, reversed: false, scale: "linear" } as const;
    const base = renderTileTriggers({ min: 0, max: 1 }, style);
    expect(renderTileTriggers({ min: 0, max: 1 }, style)).toEqual(base);
    expect(renderTileTriggers({ min: 0, max: 2 }, style)).not.toEqual(base);
    expect(
      renderTileTriggers({ min: 0, max: 1 }, { ...style, scale: "log" })
    ).not.toEqual(base);
  });
});
