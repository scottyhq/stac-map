/**
 * Builds a GDAL VRT time stack from STAC items: one band per item × asset, in
 * the assets' native CRS, cropped to a window. Everything comes from the
 * items' projection (`proj:*`) and raster (`raster:bands` / `bands`)
 * metadata, so no COG has to be opened in the browser.
 */
import {
  epsgResolver,
  projectionFunctions,
  transformBounds,
} from "@developmentseed/proj";
import type { StacAsset, StacItem } from "stac-ts";
import { toGdalPath } from "./download-items";

export type Bounds = [number, number, number, number];

/** One asset's grid, read from its STAC projection metadata. */
export interface AssetGrid {
  /** e.g. "EPSG:3413". */
  crs: string;
  /** [xmin, ymin, xmax, ymax] in `crs`. */
  bounds: Bounds;
  resX: number;
  /** Positive; the pixel height. */
  resY: number;
  width: number;
  height: number;
  dataType: string;
  nodata?: number;
}

/** A pixel grid aligned to an asset grid, cropped to some bounds. */
export interface VrtWindow {
  crs: string;
  bounds: Bounds;
  resX: number;
  resY: number;
  width: number;
  height: number;
}

export interface VrtBand {
  item: StacItem;
  assetKey: string;
  grid: AssetGrid;
}

const DATA_TYPES: Record<string, string> = {
  int8: "Int8",
  uint8: "Byte",
  int16: "Int16",
  uint16: "UInt16",
  int32: "Int32",
  uint32: "UInt32",
  int64: "Int64",
  uint64: "UInt64",
  float16: "Float32",
  float32: "Float32",
  float64: "Float64",
  cint16: "CInt16",
  cint32: "CInt32",
  cfloat32: "CFloat32",
  cfloat64: "CFloat64",
};

type Fields = Record<string, unknown>;

/** The CRS of an asset (or its item), as "EPSG:<code>", if known. */
export function getCrs(item: StacItem, asset: StacAsset): string | undefined {
  for (const fields of [asset as Fields, item.properties as Fields]) {
    const code = fields["proj:code"];
    if (typeof code === "string" && /^EPSG:\d+$/i.test(code))
      return code.toUpperCase();
    const epsg = fields["proj:epsg"];
    if (typeof epsg === "number") return `EPSG:${epsg}`;
  }
  return undefined;
}

/**
 * The asset's grid from `proj:transform` + `proj:shape` (on the asset or its
 * item). Undefined when they're missing or the grid is rotated.
 */
export function getAssetGrid(
  item: StacItem,
  asset: StacAsset
): AssetGrid | undefined {
  const pick = (key: string) =>
    (asset as Fields)[key] ?? (item.properties as Fields)[key];
  const transform = pick("proj:transform") as number[] | undefined;
  const shape = pick("proj:shape") as number[] | undefined;
  const crs = getCrs(item, asset);
  if (!crs || !transform || transform.length < 6 || !shape) return undefined;
  const [a, b, c, d, e, f] = transform;
  if (b !== 0 || d !== 0 || a <= 0 || e >= 0) return undefined;
  const [height, width] = shape;
  const bands = ((asset as Fields)["raster:bands"] ??
    (asset as Fields)["bands"]) as Fields[] | undefined;
  const band = bands?.[0];
  const dataType = DATA_TYPES[String(band?.data_type ?? "")] ?? "Float32";
  const nodata = typeof band?.nodata === "number" ? band.nodata : undefined;
  return {
    crs,
    bounds: [c, f + height * e, c + width * a, f],
    resX: a,
    resY: -e,
    width,
    height,
    dataType,
    nodata,
  };
}

/** The bands of the stack, in item order then `assetKeys` order. */
export function getVrtBands(
  items: StacItem[],
  assetKeys: string[]
): { bands: VrtBand[]; skipped: number } {
  const bands: VrtBand[] = [];
  let skipped = 0;
  for (const item of items) {
    for (const assetKey of assetKeys) {
      const asset = item.assets?.[assetKey];
      if (!asset) continue;
      const grid = getAssetGrid(item, asset);
      if (grid) bands.push({ item, assetKey, grid });
      else skipped++;
    }
  }
  return { bands, skipped };
}

function intersect(a: Bounds, b: Bounds): Bounds | undefined {
  const out: Bounds = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  return out[0] < out[2] && out[1] < out[3] ? out : undefined;
}

function union(bounds: Bounds[]): Bounds {
  return [
    Math.min(...bounds.map((b) => b[0])),
    Math.min(...bounds.map((b) => b[1])),
    Math.max(...bounds.map((b) => b[2])),
    Math.max(...bounds.map((b) => b[3])),
  ];
}

/**
 * The output grid: the reference grid's resolution and pixel alignment,
 * covering the union of the bands' extents, cropped to `crop` (in the same
 * CRS) when given. Undefined if the crop misses the data.
 */
export function getVrtWindow(
  reference: AssetGrid,
  extents: Bounds[],
  crop?: Bounds
): VrtWindow | undefined {
  const extent = union(extents);
  const bounds = crop ? intersect(extent, crop) : extent;
  if (!bounds) return undefined;
  // Snap outwards to the reference grid's pixel edges.
  const { resX, resY } = reference;
  const [ox, , , oy] = reference.bounds;
  const xmin = ox + Math.floor(round((bounds[0] - ox) / resX)) * resX;
  const xmax = ox + Math.ceil(round((bounds[2] - ox) / resX)) * resX;
  const ymax = oy - Math.floor(round((oy - bounds[3]) / resY)) * resY;
  const ymin = oy - Math.ceil(round((oy - bounds[1]) / resY)) * resY;
  return {
    crs: reference.crs,
    bounds: [xmin, ymin, xmax, ymax],
    resX,
    resY,
    width: Math.round((xmax - xmin) / resX),
    height: Math.round((ymax - ymin) / resY),
  };
}

/** Rounds away float noise (e.g. 2.9999999999 → 3). */
function round(v: number, digits = 6): number {
  return Number(v.toFixed(digits));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bandXml(band: VrtBand, index: number, window: VrtWindow): string {
  const { item, assetKey, grid } = band;
  const href = item.assets[assetKey].href;
  const datetime = (item.properties?.datetime as string | null) ?? "";
  const description = `${datetime.slice(0, 10)} ${assetKey}`.trim();
  const lines = [
    `  <VRTRasterBand dataType="${grid.dataType}" band="${index + 1}">`,
    `    <Description>${escapeXml(description)}</Description>`,
    `    <Metadata>`,
    `      <MDI key="id">${escapeXml(item.id)}</MDI>`,
    `      <MDI key="datetime">${escapeXml(datetime)}</MDI>`,
    `      <MDI key="asset">${escapeXml(assetKey)}</MDI>`,
    `    </Metadata>`,
  ];
  if (grid.nodata !== undefined)
    lines.push(`    <NoDataValue>${grid.nodata}</NoDataValue>`);
  const overlap = intersect(grid.bounds, window.bounds);
  if (overlap) {
    const src = [
      (overlap[0] - grid.bounds[0]) / grid.resX,
      (grid.bounds[3] - overlap[3]) / grid.resY,
      (overlap[2] - overlap[0]) / grid.resX,
      (overlap[3] - overlap[1]) / grid.resY,
    ].map((v) => round(v));
    const dst = [
      (overlap[0] - window.bounds[0]) / window.resX,
      (window.bounds[3] - overlap[3]) / window.resY,
      (overlap[2] - overlap[0]) / window.resX,
      (overlap[3] - overlap[1]) / window.resY,
    ].map((v) => round(v));
    lines.push(
      `    <SimpleSource>`,
      `      <SourceFilename relativeToVRT="0">${escapeXml(toGdalPath(href))}</SourceFilename>`,
      `      <SourceBand>1</SourceBand>`,
      `      <SourceProperties RasterXSize="${grid.width}" RasterYSize="${grid.height}" DataType="${grid.dataType}" />`,
      `      <SrcRect xOff="${src[0]}" yOff="${src[1]}" xSize="${src[2]}" ySize="${src[3]}" />`,
      `      <DstRect xOff="${dst[0]}" yOff="${dst[1]}" xSize="${dst[2]}" ySize="${dst[3]}" />`,
      `    </SimpleSource>`
    );
  }
  lines.push(`  </VRTRasterBand>`);
  return lines.join("\n");
}

/** The VRT XML for `bands` on `window`. */
export function buildStackVrt(bands: VrtBand[], window: VrtWindow): string {
  const [xmin, , , ymax] = window.bounds;
  const geoTransform = [xmin, window.resX, 0, ymax, 0, -window.resY].join(", ");
  return [
    `<VRTDataset rasterXSize="${window.width}" rasterYSize="${window.height}">`,
    `  <SRS dataAxisToSRSAxisMapping="1,2">${escapeXml(window.crs)}</SRS>`,
    `  <GeoTransform>${geoTransform}</GeoTransform>`,
    ...bands.map((band, i) => bandXml(band, i, window)),
    `</VRTDataset>`,
    "",
  ].join("\n");
}

async function projection(crs: string) {
  const code = Number(crs.split(":")[1]);
  return projectionFunctions(await epsgResolver(code));
}

/** A lon/lat box as bounds in `crs` (edges densified, so curved edges count). */
export async function lonLatToCrsBounds(
  crs: string,
  bbox: Bounds
): Promise<Bounds> {
  const { projectFrom4326 } = await projection(crs);
  const [w, s, e, n] = bbox;
  return transformBounds(
    projectFrom4326,
    w,
    Math.max(s, -89.9),
    e,
    Math.min(n, 89.9)
  );
}

/** Bounds in `crs` as a lon/lat box. */
export async function crsToLonLatBounds(
  crs: string,
  bounds: Bounds
): Promise<Bounds> {
  const { projectTo4326 } = await projection(crs);
  return transformBounds(projectTo4326, ...bounds);
}
