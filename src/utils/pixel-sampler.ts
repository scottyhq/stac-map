import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import {
  epsgResolver,
  parseWkt,
  projectionFunctions,
  type ProjectionFunction,
} from "@developmentseed/proj";

/** The parts of a GeoTIFF or overview that pixel lookup needs. */
export type TiledImage = Pick<
  GeoTIFF | Overview,
  "width" | "height" | "tileWidth" | "tileHeight" | "index"
>;

/** A decoded single-band tile, kept on the CPU so it can be sampled. */
export type SampledTile = {
  image: TiledImage;
  x: number;
  y: number;
  width: number;
  height: number;
  values: Float32Array;
  validMask: Uint8Array | null;
};

export type PixelSample = {
  value: number;
  /** 0 is the full-resolution image; higher numbers are coarser overviews. */
  level: number;
};

/**
 * Samples a single-band COG under the cursor from the tiles that are already
 * loaded. The value comes from the finest loaded level that covers the point,
 * so when zoomed out it is an overview value and therefore approximate.
 */
export class PixelSampler {
  private readonly levels: TiledImage[];
  private readonly tiles = new Map<TiledImage, Map<string, SampledTile>>();
  private projectFrom4326: ProjectionFunction | null = null;
  private readonly nodata: number | null;

  /**
   * @param levels  Images ordered finest first: the full-resolution image,
   *                then its overviews.
   * @param projectFrom4326  Projects WGS84 longitude and latitude to the
   *                image's CRS. While a promise is pending, `sample` returns
   *                null; tiles can still be added.
   * @param nodata  The nodata value, if any.
   */
  constructor(
    levels: TiledImage[],
    projectFrom4326: ProjectionFunction | Promise<ProjectionFunction>,
    nodata: number | null
  ) {
    this.levels = levels;
    this.nodata = nodata;
    if (typeof projectFrom4326 === "function") {
      this.projectFrom4326 = projectFrom4326;
    } else {
      projectFrom4326.then(
        (fn) => (this.projectFrom4326 = fn),
        (error) => console.warn("Pixel sampler: cannot resolve CRS", error)
      );
    }
  }

  add(tile: SampledTile): void {
    let byIndex = this.tiles.get(tile.image);
    if (!byIndex) {
      byIndex = new Map();
      this.tiles.set(tile.image, byIndex);
    }
    byIndex.set(key(tile.x, tile.y), tile);
  }

  remove(tile: SampledTile): void {
    const byIndex = this.tiles.get(tile.image);
    const k = key(tile.x, tile.y);
    if (byIndex?.get(k) === tile) byIndex.delete(k);
  }

  sample(lng: number, lat: number): PixelSample | null {
    if (!this.projectFrom4326) return null;
    let x: number, y: number;
    try {
      [x, y] = this.projectFrom4326(lng, lat);
    } catch {
      return null;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    for (let level = 0; level < this.levels.length; level++) {
      const image = this.levels[level];
      const byIndex = this.tiles.get(image);
      if (!byIndex || byIndex.size === 0) continue;
      const [row, col] = image.index(x, y);
      if (row < 0 || col < 0 || row >= image.height || col >= image.width) {
        // Outside the image: no level will cover it either.
        return null;
      }
      const tx = Math.floor(col / image.tileWidth);
      const ty = Math.floor(row / image.tileHeight);
      const tile = byIndex.get(key(tx, ty));
      if (!tile) continue;
      const r = row - ty * image.tileHeight;
      const c = col - tx * image.tileWidth;
      if (r >= tile.height || c >= tile.width) continue;
      const i = r * tile.width + c;
      if (tile.validMask && tile.validMask[i] === 0) return null;
      const value = tile.values[i];
      if (Number.isNaN(value)) return null;
      if (this.nodata !== null && value === this.nodata) return null;
      return { value, level };
    }
    return null;
  }
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Builds a {@link PixelSampler} for a GeoTIFF. The CRS resolves in the
 * background, so the sampler can collect tiles straight away.
 */
export function createPixelSampler(geotiff: GeoTIFF): PixelSampler {
  return new PixelSampler(
    [geotiff, ...geotiff.overviews],
    resolveProjectFrom4326(geotiff.crs),
    geotiff.cachedPrimaryImageTags.nodata
  );
}

async function resolveProjectFrom4326(
  crs: GeoTIFF["crs"]
): Promise<ProjectionFunction> {
  const projection =
    typeof crs === "number" ? await epsgResolver(crs) : parseWkt(crs);
  return projectionFunctions(projection).projectFrom4326;
}

/** Formats a sampled value for display. */
export function formatPixelValue(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return Number(value.toPrecision(6)).toString();
}
