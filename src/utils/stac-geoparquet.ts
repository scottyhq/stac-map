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
  let query = `SELECT ${select} FROM read_parquet('${href}', hive_partitioning = ${hivePartitioning})`;
  if (where) {
    query += ` WHERE ${where}`;
  }
  return (await connection.query(query)) as unknown as Table;
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
  return {
    type: "FeatureCollection",
    id: href.split("/").pop(),
    description: `A stac-geoparquet file with ${count} item${count === 1 ? "" : "s"}`,
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
    const query = `SELECT typeof(bbox) as bbox_type FROM read_parquet('${href}', hive_partitioning = ${hivePartitioning}) LIMIT 1`;
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
    where: `id = '${id}'`,
  });
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

/**
 * Finds the items immediately before and after `id` in time that intersect its
 * geometry, i.e. the same place at the previous and next time step. Items with
 * the same datetime are ordered by id. Only items inside `datetimeFilter` can be
 * stepped to.
 */
export async function fetchStacGeoparquetAdjacentIds({
  id,
  href,
  connection,
  hivePartitioning,
  datetimeFilter,
}: {
  id: string;
  href: string;
  connection: AsyncDuckDBConnection;
  hivePartitioning: boolean;
  datetimeFilter?: [number, number];
}): Promise<{ previous: string | null; next: string | null }> {
  const source = `read_parquet('${href}', hive_partitioning = ${hivePartitioning})`;
  const escapedId = id.replaceAll("'", "''");
  const where = datetimeFilterToWhere(datetimeFilter, "other.datetime");
  const adjacent = (comparison: "<" | ">", order: "ASC" | "DESC") => `(
    SELECT other.id FROM ${source} AS other, current
    WHERE (other.datetime ${comparison} current.datetime
      OR (other.datetime = current.datetime AND other.id ${comparison} current.id))
      AND ST_Intersects(other.geometry, current.geometry)
      ${where ? `AND ${where}` : ""}
    ORDER BY other.datetime ${order}, other.id ${order}
    LIMIT 1
  )`;
  const query = `WITH current AS (
    SELECT id, datetime, geometry FROM ${source} WHERE id = '${escapedId}'
  )
  SELECT ${adjacent("<", "DESC")} AS previous, ${adjacent(">", "ASC")} AS next`;
  const result = (await connection.query(query)) as unknown as Table;
  const row = result.toArray().map((row) => row.toJSON())[0];
  return { previous: row?.previous ?? null, next: row?.next ?? null };
}
