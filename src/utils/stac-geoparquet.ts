import { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { data, io } from "@geoarrow/geoarrow-js";
import {
  Binary,
  Data,
  makeData,
  makeVector,
  Table,
  vectorFromArray,
} from "apache-arrow";
import { toaster } from "../components/ui/toaster";
import type { StacItemCollection } from "../types/stac";
import {
  parseMultiPolygonWkb,
  type MultiPolygonData,
} from "./custom-wkb-parser";
import { resolveParquetSource } from "./parquet-cache";
import { loadStacWasm } from "./stac-wasm";

const SUPPORTED_GEOMETRY_TYPES = [
  "point",
  "polygon",
  "linestring",
  "multipolygon",
] as const;

async function executeDuckdbQuery({
  connection,
  select,
  href,
  where,
  hivePartitioning,
}: {
  connection: AsyncDuckDBConnection;
  select: string;
  href: string;
  where?: string;
  hivePartitioning: boolean;
}): Promise<Table> {
  const source = await readParquetSql(connection, href, hivePartitioning);
  let query = `SELECT ${select} FROM ${source}`;
  if (where) {
    query += ` WHERE ${where}`;
  }
  return (await connection.query(query)) as unknown as Table;
}

/** The `read_parquet(...)` call for `href`, reading a cached copy if there is one. */
async function readParquetSql(
  connection: AsyncDuckDBConnection,
  href: string,
  hivePartitioning: boolean
): Promise<string> {
  const source = await resolveParquetSource(connection, href, hivePartitioning);
  return `read_parquet('${source}', hive_partitioning = ${hivePartitioning})`;
}

export type SupportedGeometryType = (typeof SUPPORTED_GEOMETRY_TYPES)[number];

export async function fetchStacGeoparquetValue({
  href,
  connection,
  hivePartitioning,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
}): Promise<StacItemCollection> {
  const { count, bbox } = await fetchStacGeoparquetSummary({
    href,
    connection,
    hivePartitioning,
  });
  const datetimeExtent = await fetchStacGeoparquetDatetimeExtent({
    href,
    connection,
    hivePartitioning,
  });
  const collection = await fetchStacGeoparquetCollection({
    href,
    connection,
    hivePartitioning,
  });
  const countDescription = `A stac-geoparquet file with ${count} item${count === 1 ? "" : "s"}`;
  return {
    type: "FeatureCollection",
    id: href.split("/").pop(),
    title: collection?.title,
    description: collection?.description
      ? `${collection.description}\n\n${countDescription}.`
      : countDescription,
    bbox,
    features: [],
    datetimeExtent,
    assets: {
      data: {
        href: href,
        type: "application/vnd.apache.parquet",
      },
    },
  };
}

/**
 * Read the STAC Collection embedded in the file's key-value metadata, per the
 * stac-geoparquet spec (key "stac-geoparquet", value `{version, collections}`).
 * Returns the Collection only when the file holds exactly one; otherwise null.
 */
async function fetchStacGeoparquetCollection({
  href,
  connection,
  hivePartitioning,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
}): Promise<{ title?: string; description?: string } | null> {
  try {
    const source = await resolveParquetSource(
      connection,
      href,
      hivePartitioning
    );
    const query = `SELECT decode(value) AS value FROM parquet_kv_metadata('${source}') WHERE decode(key) = 'stac-geoparquet' LIMIT 1`;
    const result = (await connection.query(query)) as unknown as Table;
    const row = result.toArray().map((row) => row.toJSON())[0];
    if (!row?.value) return null;
    const collections = Object.values(
      JSON.parse(row.value as string).collections ?? {}
    ) as { title?: string; description?: string }[];
    return collections.length === 1 ? collections[0] : null;
  } catch {
    return null;
  }
}

async function fetchStacGeoparquetSummary({
  href,
  connection,
  hivePartitioning,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
}): Promise<{ count: number; bbox: [number, number, number, number] }> {
  const bboxType = await getBboxColumnType({
    href,
    connection,
    hivePartitioning,
  });

  if (bboxType?.startsWith("STRUCT")) {
    const result = await executeDuckdbQuery({
      connection,
      href,
      hivePartitioning,
      select:
        "COUNT(*) as count, MIN(bbox.xmin) as xmin, MIN(bbox.ymin) as ymin, MAX(bbox.xmax) as xmax, MAX(bbox.ymax) as ymax",
    });
    const row = result.toArray().map((row) => row.toJSON())[0];
    return {
      count: row.count,
      bbox: [row.xmin, row.ymin, row.xmax, row.ymax],
    };
  }

  if (bboxType === "DOUBLE[]") {
    toaster.create({
      title: "Non-spec stac-geoparquet",
      description:
        "The 'bbox' column is a list of doubles, but the stac-geoparquet spec requires a struct of {xmin, ymin, xmax, ymax}. Reading bbox values from the list instead.",
      type: "warning",
    });
    const result = await executeDuckdbQuery({
      connection,
      href,
      hivePartitioning,
      select:
        "COUNT(*) as count, MIN(bbox[1]) as xmin, MIN(bbox[2]) as ymin, MAX(bbox[3]) as xmax, MAX(bbox[4]) as ymax",
    });
    const row = result.toArray().map((row) => row.toJSON())[0];
    return {
      count: row.count,
      bbox: [row.xmin, row.ymin, row.xmax, row.ymax],
    };
  }

  if (bboxType) {
    toaster.create({
      title: "Non-spec stac-geoparquet",
      description: `The 'bbox' column has type '${bboxType}', but the stac-geoparquet spec requires a struct of {xmin, ymin, xmax, ymax}. Computing the extent from the geometry column instead.`,
      type: "warning",
    });
  }

  const result = await executeDuckdbQuery({
    connection,
    href,
    hivePartitioning,
    select: "COUNT(*) as count, ST_Extent_Agg(geometry) as extent",
  });
  const row = result.toArray().map((row) => row.toJSON())[0];
  const extent = row.extent;
  return {
    count: row.count,
    bbox: [extent.min_x, extent.min_y, extent.max_x, extent.max_y],
  };
}

async function getBboxColumnType({
  href,
  connection,
  hivePartitioning,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
}): Promise<string | null> {
  try {
    const source = await readParquetSql(connection, href, hivePartitioning);
    const query = `SELECT typeof(bbox) as bbox_type FROM ${source} LIMIT 1`;
    const result = (await connection.query(query)) as unknown as Table;
    const row = result.toArray().map((row) => row.toJSON())[0];
    return (row?.bbox_type as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function fetchStacGeoparquetDatetimeExtent({
  href,
  connection,
  hivePartitioning,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
}): Promise<[number, number] | null> {
  try {
    const result = await executeDuckdbQuery({
      connection,
      href,
      hivePartitioning,
      select: "MIN(datetime) as dt_min, MAX(datetime) as dt_max",
    });
    const row = result.toArray().map((row) => row.toJSON())[0];
    const min = row?.dt_min ? new Date(row.dt_min).getTime() : NaN;
    const max = row?.dt_max ? new Date(row.dt_max).getTime() : NaN;
    if (Number.isNaN(min) || Number.isNaN(max)) return null;
    return [min, max];
  } catch {
    return null;
  }
}

export async function fetchStacGeoparquetTable({
  href,
  connection,
  hivePartitioning,
  where,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
  where?: string;
}) {
  const result = await executeDuckdbQuery({
    connection,
    href,
    hivePartitioning,
    where,
    select:
      "ST_AsWKB(geometry) AS geometry, ST_GeometryType(geometry) AS geometry_type, id",
  });
  const geometry: Uint8Array[] = result.getChildAt(0)?.toArray();
  const geometryType = result.getChildAt(1)?.toArray()[0]?.toLowerCase() as
    string | undefined;
  if (
    !geometryType ||
    !SUPPORTED_GEOMETRY_TYPES.includes(geometryType as SupportedGeometryType)
  ) {
    throw new Error(
      `Unsupported geometry type: ${geometryType}. Supported types: ${SUPPORTED_GEOMETRY_TYPES.join(", ")}`
    );
  }

  const wkb = new Uint8Array(geometry?.flatMap((array) => [...array]));
  const valueOffsets = new Int32Array(geometry.length + 1);
  for (let i = 0, len = geometry.length; i < len; i++) {
    const current = valueOffsets[i];
    valueOffsets[i + 1] = current + geometry[i].length;
  }
  const wkbData: Data<Binary> = makeData({
    type: new Binary(),
    data: wkb,
    valueOffsets,
  });
  let table: Table | undefined = undefined;
  if (geometryType === "polygon") {
    const polygons = io.parseWkb(
      wkbData,
      io.WKBType.Polygon,
      2
    ) as data.PolygonData;
    table = new Table({
      geometry: makeVector(polygons),
      id: vectorFromArray(result.getChild("id")?.toArray()),
    });
    table.schema.fields[0].metadata.set(
      "ARROW:extension:name",
      "geoarrow.polygon"
    );
  } else if (geometryType === "multipolygon") {
    const multipolygons = parseMultiPolygonWkb(
      wkbData,
      "MultiPolygon",
      2
    ) as MultiPolygonData;
    table = new Table({
      geometry: makeVector(multipolygons),
      id: vectorFromArray(result.getChild("id")?.toArray()),
    });
    table.schema.fields[0].metadata.set(
      "ARROW:extension:name",
      "geoarrow.multipolygon"
    );
  } else if (geometryType === "point") {
    const points = io.parseWkb(wkbData, io.WKBType.Point, 2) as data.PointData;
    table = new Table({
      geometry: makeVector(points),
      id: vectorFromArray(result.getChild("id")?.toArray()),
    });
    table.schema.fields[0].metadata.set(
      "ARROW:extension:name",
      "geoarrow.point"
    );
  } else if (geometryType === "linestring") {
    const linestrings = io.parseWkb(
      wkbData,
      io.WKBType.LineString,
      2
    ) as data.LineStringData;
    table = new Table({
      geometry: makeVector(linestrings),
      id: vectorFromArray(result.getChild("id")?.toArray()),
    });
    table.schema.fields[0].metadata.set(
      "ARROW:extension:name",
      "geoarrow.linestring"
    );
  }
  return {
    table,
    geometryType: geometryType as SupportedGeometryType | undefined,
  };
}

export async function fetchStacGeoparquetItem({
  id,
  href,
  connection,
  hivePartitioning,
}: {
  id: string;
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
}) {
  const result = await executeDuckdbQuery({
    connection,
    href,
    hivePartitioning,
    select: "* REPLACE ST_AsGeoJSON(geometry) as geometry",
    where: `id = '${id.replaceAll("'", "''")}'`,
  });
  if (result.numRows === 0) throw new Error(`No item with id "${id}"`);
  const stacWasm = await loadStacWasm();
  const item = stacWasm.arrowToStacJson(result)[0];
  item.geometry = JSON.parse(item.geometry);
  return item;
}

/**
 * Builds a SQL `WHERE` clause that keeps items whose `datetime` falls inside a
 * datetime filter (milliseconds since the epoch).
 */
export function datetimeFilterToWhere(
  filter: [number, number] | undefined,
  column = "datetime"
): string | undefined {
  if (!filter) return undefined;
  const start = new Date(filter[0]).toISOString();
  const end = new Date(filter[1]).toISOString();
  return `${column} BETWEEN TIMESTAMP '${start}' AND TIMESTAMP '${end}'`;
}

/** One item in a {@link fetchStacGeoparquetTimeline} result. */
export interface TimelineEntry {
  id: string;
  /** The item's `datetime`, in milliseconds since the epoch. */
  datetime: number;
}

/**
 * Footprints count as "the same place" when their intersection covers at least
 * this fraction of the smaller footprint. This keeps repeat acquisitions of a
 * site (identical footprints, or partial-coverage footprints inside one tile)
 * while dropping neighbouring sites or tiles that only share an edge strip.
 */
export const SAME_PLACE_OVERLAP = 0.8;

/**
 * Lists every item at the same place as `id` (including `id` itself; see
 * {@link SAME_PLACE_OVERLAP}), ordered by datetime and then id. These are the
 * time steps the datetime slider shows as ticks and the previous/next buttons
 * step through.
 */
export async function fetchStacGeoparquetTimeline({
  id,
  href,
  connection,
  hivePartitioning,
}: {
  id: string;
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
}): Promise<TimelineEntry[]> {
  const source = await readParquetSql(connection, href, hivePartitioning);
  const escapedId = id.replaceAll("'", "''");
  const query = `WITH current AS (
    SELECT geometry FROM ${source} WHERE id = '${escapedId}' LIMIT 1
  )
  SELECT other.id AS id, epoch_ms(other.datetime) AS datetime_ms
  FROM ${source} AS other, current
  WHERE other.datetime IS NOT NULL
    AND ST_Intersects(other.geometry, current.geometry)
    AND ST_Area(ST_Intersection(other.geometry, current.geometry))
      >= ${SAME_PLACE_OVERLAP} * LEAST(ST_Area(other.geometry), ST_Area(current.geometry))
  ORDER BY other.datetime, other.id`;
  const result = (await connection.query(query)) as unknown as Table;
  return result
    .toArray()
    .map((row) => row.toJSON())
    .map((row) => ({ id: String(row.id), datetime: Number(row.datetime_ms) }));
}

/**
 * Finds the entries immediately before and after `id` in a timeline, skipping
 * entries outside `datetimeFilter` (milliseconds since the epoch, inclusive).
 */
export function getAdjacentTimelineIds(
  timeline: TimelineEntry[],
  id: string,
  datetimeFilter?: [number, number]
): { previous: string | null; next: string | null } {
  const index = timeline.findIndex((entry) => entry.id === id);
  if (index === -1) return { previous: null, next: null };
  const inFilter = (entry: TimelineEntry) =>
    !datetimeFilter ||
    (entry.datetime >= datetimeFilter[0] &&
      entry.datetime <= datetimeFilter[1]);
  const previous = timeline.slice(0, index).reverse().find(inFilter);
  const next = timeline.slice(index + 1).find(inFilter);
  return { previous: previous?.id ?? null, next: next?.id ?? null };
}
