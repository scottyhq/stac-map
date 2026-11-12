import { Photometric } from "@cogeotiff/core";
import type { COGLayerProps } from "@developmentseed/deck.gl-geotiff";
import {
  BlackIsZero,
  CreateTexture,
  FilterNoDataVal,
  LinearRescale,
  MaskTexture,
  WhiteIsZero,
  type RasterModule,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import type { StacAsset } from "stac-ts";
import {
  Colormap,
  COLORMAP_NAMES,
  getColormapTexture,
  LogRescale,
  type ColormapName,
} from "./colormap";
import type { SampledTile } from "./pixel-sampler";

export type BandRange = { min: number; max: number };

function toRange(min: unknown, max: unknown): BandRange | undefined {
  if (typeof min !== "number" || typeof max !== "number") return undefined;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return { min, max };
}

type StacBand = { statistics?: unknown; unit?: unknown };

/** The asset's first band, from STAC 1.1 `bands` or the raster extension. */
function getFirstStacBand(asset: StacAsset): StacBand | undefined {
  const fields = asset as { bands?: StacBand[]; "raster:bands"?: StacBand[] };
  return fields.bands?.[0] ?? fields["raster:bands"]?.[0];
}

export function getStacBandStatistics(asset: StacAsset): BandRange | undefined {
  const statistics = getFirstStacBand(asset)?.statistics as
    | { minimum?: unknown; maximum?: unknown }
    | undefined;
  if (!statistics) return undefined;
  return toRange(statistics.minimum, statistics.maximum);
}

/** The unit of the asset's first band (e.g. "dB", "m/yr"), if given. */
export function getStacBandUnit(asset: StacAsset): string | undefined {
  const unit = getFirstStacBand(asset)?.unit;
  return typeof unit === "string" && unit.trim() ? unit.trim() : undefined;
}

export function getStoredBandStatistics(
  geotiff: GeoTIFF
): BandRange | undefined {
  const stats = geotiff.storedStats?.get(1);
  if (!stats) return undefined;
  return toRange(stats.min, stats.max);
}

export function resolveBandRange(
  asset: StacAsset | undefined,
  geotiff: GeoTIFF
): BandRange | undefined {
  return (
    (asset && getStacBandStatistics(asset)) ?? getStoredBandStatistics(geotiff)
  );
}

export type RasterScale = "linear" | "log";

/** How a single-band raster is drawn. */
export type RasterStyle = {
  /** `null` draws greyscale, following the TIFF's photometric interpretation. */
  colormap: ColormapName | null;
  reversed: boolean;
  scale: RasterScale;
};

export const DEFAULT_RASTER_STYLE: RasterStyle = {
  colormap: null,
  reversed: false,
  scale: "linear",
};

/** How many decades a log scale spans when the range's minimum is ≤ 0. */
const LOG_FALLBACK_DECADES = 3;

/**
 * The range a log scale actually uses. A log scale needs a positive minimum,
 * so a minimum ≤ 0 is raised to {@link LOG_FALLBACK_DECADES} decades below the
 * maximum. Returns undefined when the maximum isn't positive either.
 */
export function logScaleRange(range: BandRange): BandRange | undefined {
  if (!(range.max > 0)) return undefined;
  const min =
    range.min > 0 ? range.min : range.max / 10 ** LOG_FALLBACK_DECADES;
  if (min >= range.max) return undefined;
  return { min, max: range.max };
}

/**
 * Values that change how loaded tiles are drawn. Pass as
 * `updateTriggers.renderTile` so a change re-renders tiles without refetching.
 */
export function renderTileTriggers(
  range: BandRange | undefined,
  style: RasterStyle
): unknown[] {
  return [range?.min, range?.max, style.colormap, style.reversed, style.scale];
}

export type SingleBandTileData = SampledTile & {
  texture: Texture;
  mask?: Texture;
  colormapTexture: Texture;
  height: number;
  width: number;
  byteLength: number;
};

export type SingleBandPipeline = Pick<
  COGLayerProps<SingleBandTileData>,
  "getTileData" | "renderTile"
>;

export function isSingleBandGreyscale(geotiff: GeoTIFF): boolean {
  const { samplesPerPixel, photometric } = geotiff.cachedPrimaryImageTags;
  return samplesPerPixel === 1 && photometric !== Photometric.Palette;
}

export function singleBandPipeline(
  geotiff: GeoTIFF,
  range: BandRange | undefined,
  style: RasterStyle = DEFAULT_RASTER_STYLE
): SingleBandPipeline | undefined {
  if (!isSingleBandGreyscale(geotiff)) {
    return undefined;
  }
  const { photometric, nodata } = geotiff.cachedPrimaryImageTags;

  const getTileData: SingleBandPipeline["getTileData"] = async (
    image: GeoTIFF | Overview,
    { device, x, y, signal, pool }
  ) => {
    const { array } = await image.fetchTile(x, y, {
      boundless: false,
      pool,
      signal,
    });
    const { width, height, mask } = array;
    const source =
      array.layout === "band-separate" ? array.bands[0] : array.data;
    const data =
      source instanceof Float32Array ? source : new Float32Array(source);
    const texture = device.createTexture({
      data,
      format: "r32float",
      width,
      height,
      sampler: { minFilter: "nearest", magFilter: "nearest" },
    });
    // The values stay on the CPU too so the pixel sampler can read them.
    let byteLength = data.byteLength * 2;
    let maskTexture: Texture | undefined;
    if (mask) {
      maskTexture = device.createTexture({
        data: mask,
        format: "r8unorm",
        width,
        height,
        sampler: { minFilter: "nearest", magFilter: "nearest" },
      });
      byteLength += mask.byteLength * 2;
    }
    return {
      texture,
      mask: maskTexture,
      colormapTexture: getColormapTexture(device),
      byteLength,
      width,
      height,
      image,
      x,
      y,
      values: data,
      validMask: mask,
    };
  };

  const renderTile: SingleBandPipeline["renderTile"] = (data) => {
    const renderPipeline: RasterModule[] = [
      { module: CreateTexture, props: { textureName: data.texture } },
    ];
    if (nodata !== null) {
      renderPipeline.push({
        module: FilterNoDataVal,
        props: { value: nodata },
      });
    }
    if (data.mask) {
      renderPipeline.push({
        module: MaskTexture,
        props: { maskTexture: data.mask },
      });
    }
    const logRange =
      range && style.scale === "log" ? logScaleRange(range) : undefined;
    if (logRange) {
      renderPipeline.push({
        module: LogRescale,
        props: {
          logMin: Math.log(logRange.min),
          logMax: Math.log(logRange.max),
        },
      });
    } else if (range) {
      renderPipeline.push({
        module: LinearRescale,
        props: { rescaleMin: range.min, rescaleMax: range.max },
      });
    }
    if (style.colormap) {
      renderPipeline.push({
        module: Colormap,
        props: {
          colormapTexture: data.colormapTexture,
          colormapIndex: COLORMAP_NAMES.indexOf(style.colormap),
          colormapCount: COLORMAP_NAMES.length,
          reversed: style.reversed,
        },
      });
    } else {
      const whiteIsZero = photometric === Photometric.MinIsWhite;
      renderPipeline.push({
        module: whiteIsZero !== style.reversed ? WhiteIsZero : BlackIsZero,
      });
    }
    return { renderPipeline };
  };

  return { getTileData, renderTile };
}

export function accumulateMinMax(
  acc: { min: number; max: number },
  values: ArrayLike<number>,
  mask: Uint8Array | null,
  nodata: number | null
): void {
  for (let i = 0; i < values.length; i++) {
    if (mask && mask[i] === 0) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (nodata !== null && v === nodata) continue;
    if (v < acc.min) acc.min = v;
    if (v > acc.max) acc.max = v;
  }
}

export async function computeBandRangeFromOverview(
  geotiff: GeoTIFF,
  signal?: AbortSignal
): Promise<BandRange | undefined> {
  const overview = geotiff.overviews.at(-1);
  if (!overview) return undefined;
  const { nodata } = geotiff.cachedPrimaryImageTags;
  const { x: nx, y: ny } = overview.tileCount;
  const coords: [number, number][] = [];
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      coords.push([tx, ty]);
    }
  }
  const tiles = await overview.fetchTiles(coords, { boundless: false, signal });
  const acc = { min: Infinity, max: -Infinity };
  for (const { array } of tiles) {
    const source =
      array.layout === "band-separate" ? array.bands[0] : array.data;
    accumulateMinMax(acc, source, array.mask, nodata);
  }
  if (
    !Number.isFinite(acc.min) ||
    !Number.isFinite(acc.max) ||
    acc.min === acc.max
  ) {
    return undefined;
  }
  return { min: acc.min, max: acc.max };
}
