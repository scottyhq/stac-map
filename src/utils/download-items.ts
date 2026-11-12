/**
 * Helpers for the "Download items" dialog: build the filter that matches what
 * the map shows (time slider + optional map view), and the equivalent shell
 * commands for people who'd rather fetch the hrefs from a terminal.
 */
import { datetimeFilterToWhere } from "./stac-geoparquet";

export type DownloadBbox = [number, number, number, number];

export interface DownloadFilter {
  /** Milliseconds since the epoch, inclusive. Undefined means all time. */
  datetime?: [number, number];
  /** Only items intersecting this lon/lat box. */
  bbox?: DownloadBbox;
}

/** One asset href in the export. */
export interface AssetHref {
  id: string;
  assetKey: string;
  href: string;
}

/** Clamps a map view (which can wrap past ±180°) to valid lon/lat. */
export function clampBbox(bbox: DownloadBbox): DownloadBbox {
  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));
  return [
    clamp(bbox[0], -180, 180),
    clamp(bbox[1], -90, 90),
    clamp(bbox[2], -180, 180),
    clamp(bbox[3], -90, 90),
  ];
}

function round(v: number) {
  return Number(v.toFixed(6));
}

/** SQL `WHERE` clause for a {@link DownloadFilter}, or undefined if empty. */
export function downloadFilterToWhere(
  filter: DownloadFilter
): string | undefined {
  const clauses: string[] = [];
  const datetime = datetimeFilterToWhere(filter.datetime);
  if (datetime) clauses.push(datetime);
  if (filter.bbox) {
    const [xmin, ymin, xmax, ymax] = filter.bbox.map(round);
    clauses.push(
      `ST_Intersects(geometry, ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}))`
    );
  }
  return clauses.length ? clauses.join(" AND ") : undefined;
}

/** A DuckDB identifier, double-quoted (always safe, even for odd asset keys). */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Like {@link quoteIdentifier}, but leaves plain names bare for readability. */
function readableIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : quoteIdentifier(name);
}

/** Wraps a string in single quotes for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Newline-separated hrefs, one per line, ready for `wget -i`. */
export function toUrlList(hrefs: AssetHref[]): string {
  return hrefs.length ? hrefs.map((h) => h.href).join("\n") + "\n" : "";
}

/**
 * A `duckdb` CLI command that prints the same hrefs the dialog exports, one
 * per line. It uses the same SQL as stac-map, so the results match exactly.
 */
export function buildDuckdbCommand({
  href,
  assetKeys,
  filter,
  hivePartitioning = false,
}: {
  href: string;
  assetKeys: string[];
  filter: DownloadFilter;
  hivePartitioning?: boolean;
}): string {
  const hrefs = assetKeys
    .map((key) => `assets.${readableIdentifier(key)}.href`)
    .join(", ");
  const source = `read_parquet('${href.replaceAll("'", "''")}'${
    hivePartitioning ? ", hive_partitioning = true" : ""
  })`;
  const where = downloadFilterToWhere(filter);
  const lines = [
    ...(filter.bbox ? ["INSTALL spatial; LOAD spatial;"] : []),
    `SELECT href FROM (`,
    `  SELECT unnest([${hrefs}]) AS href`,
    `  FROM ${source}`,
    ...(where ? [`  WHERE ${where}`] : []),
    `) WHERE href IS NOT NULL;`,
  ];
  // A quoted heredoc passes the SQL through the shell untouched.
  return `duckdb -noheader -list > urls.txt <<'SQL'\n${lines.join("\n")}\nSQL`;
}

/**
 * A `rustac search` command piped through `jq` to print asset hrefs.
 *
 * Note: rustac matches datetime ranges against `start_datetime` /
 * `end_datetime` when present, so interval items (mosaics, composites) can
 * differ from what stac-map's slider shows.
 */
export function buildRustacCommand({
  href,
  assetKeys,
  filter,
}: {
  href: string;
  assetKeys: string[];
  filter: DownloadFilter;
}): string {
  const jqHrefs = assetKeys
    .map((key) => `.assets[${JSON.stringify(key)}].href`)
    .join(", ");
  const jq = `.features[] | (${jqHrefs}) | values`;
  return `${rustacSearch(href, filter)} \\\n  | jq -r ${shellQuote(jq)} > urls.txt`;
}

/**
 * `rustac search` piped into `stac-asset download`, which fetches the chosen
 * assets and writes an item collection pointing at the local copies.
 */
export function buildStacAssetCommand({
  href,
  assetKeys,
  filter,
  directory = "items",
}: {
  href: string;
  assetKeys: string[];
  filter: DownloadFilter;
  directory?: string;
}): string {
  const includes = assetKeys.map((key) => `-i ${shellQuote(key)}`).join(" ");
  return `${rustacSearch(href, filter)} \\\n  | stac-asset download ${includes} - ${shellQuote(directory)}`;
}

function rustacSearch(href: string, filter: DownloadFilter): string {
  const args = ["rustac", "search", shellQuote(href)];
  if (filter.datetime) {
    const [start, end] = filter.datetime.map((ms) =>
      new Date(ms).toISOString()
    );
    args.push(`--datetime=${shellQuote(`${start}/${end}`)}`);
  }
  if (filter.bbox) {
    // `=` so a negative west bound isn't parsed as a flag.
    args.push(`--bbox=${shellQuote(filter.bbox.map(round).join(","))}`);
  }
  return args.join(" ");
}

/**
 * An href as a GDAL path (`/vsicurl/`, `/vsis3/`, …); local paths unchanged.
 *
 * HTTP(S) hrefs use the `/vsicurl?` option syntax with `empty_dir=yes`, the
 * per-file equivalent of `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR`: GDAL skips
 * listing the directory and probing for sidecar files (.aux.xml, .ovr, …),
 * which would otherwise cost dozens of requests per file, and no environment
 * variable has to be set to get that.
 */
export function toGdalPath(href: string): string {
  if (/^https?:\/\//i.test(href))
    return `/vsicurl?empty_dir=yes&url=${encodeURIComponent(href)}`;
  const prefixes: [RegExp, string][] = [
    [/^s3:\/\//i, "/vsis3/"],
    [/^gs:\/\//i, "/vsigs/"],
    [/^(az|abfss?):\/\//i, "/vsiaz/"],
  ];
  for (const [pattern, prefix] of prefixes) {
    if (pattern.test(href)) return href.replace(pattern, prefix);
  }
  return href;
}

/**
 * The asset key the map is showing, from the store's `visualization` value
 * (e.g. `"items:data"` → `"data"`), if it's one of `assetKeys`.
 */
export function visualizedAssetKey(
  visualization: string | null,
  assetKeys: string[]
): string | undefined {
  if (!visualization) return undefined;
  const key = visualization.slice(visualization.indexOf(":") + 1);
  return assetKeys.includes(key) ? key : undefined;
}
