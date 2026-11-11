import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";

/**
 * Remote parquet files up to this size are downloaded once and queried from
 * memory. DuckDB-wasm reads a remote file one column chunk per blocking range
 * request, so a `SELECT *` on a wide stac-geoparquet (every asset field is its
 * own column) can take over a hundred round trips. A single GET of a small
 * file is much faster.
 */
export const MAX_CACHED_PARQUET_BYTES = 25 * 1024 * 1024;

/** Cached files are evicted, oldest first, once together they exceed this. */
export const MAX_TOTAL_CACHED_PARQUET_BYTES = 100 * 1024 * 1024;

type Entry = { source: Promise<string>; name?: string; bytes: number };

const cache = new Map<string, Entry>();
let counter = 0;

/**
 * Returns what to pass to `read_parquet()` for `href`: the name of an
 * in-memory copy registered with DuckDB when the file is remote and small
 * enough, otherwise `href` itself. Never rejects; any problem downloading the
 * file falls back to `href`, so DuckDB reads it over HTTP as before.
 */
export function resolveParquetSource(
  connection: AsyncDuckDBConnection,
  href: string,
  hivePartitioning: boolean
): Promise<string> {
  // Hive partition values come from the file's path, which a registered
  // copy wouldn't have. Globs match many files.
  if (hivePartitioning || !isSingleRemoteFile(href)) {
    return Promise.resolve(href);
  }
  let entry = cache.get(href);
  if (!entry) {
    const created: Entry = { source: Promise.resolve(href), bytes: 0 };
    created.source = download(connection, href, created);
    cache.set(href, created);
    entry = created;
  }
  return entry.source;
}

function isSingleRemoteFile(href: string): boolean {
  return /^https?:\/\//i.test(href) && !/[*[\]{}]/.test(href);
}

async function download(
  connection: AsyncDuckDBConnection,
  href: string,
  entry: Entry
): Promise<string> {
  const controller = new AbortController();
  try {
    const response = await fetch(href, { signal: controller.signal });
    const length = Number(response.headers.get("Content-Length"));
    if (
      !response.ok ||
      !Number.isFinite(length) ||
      length <= 0 ||
      length > MAX_CACHED_PARQUET_BYTES
    ) {
      controller.abort();
      return href;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const name = `stac-map-cache-${++counter}.parquet`;
    await connection.bindings.registerFileBuffer(name, bytes);
    entry.name = name;
    entry.bytes = bytes.byteLength;
    await evict(connection, href);
    return name;
  } catch {
    controller.abort();
    return href;
  }
}

async function evict(connection: AsyncDuckDBConnection, keep: string) {
  let total = 0;
  for (const entry of cache.values()) total += entry.bytes;
  // Map iteration is in insertion order, so this drops the oldest first.
  for (const [href, entry] of cache) {
    if (total <= MAX_TOTAL_CACHED_PARQUET_BYTES) break;
    if (href === keep || !entry.name) continue;
    cache.delete(href);
    total -= entry.bytes;
    await connection.bindings.dropFile(entry.name).catch(() => null);
  }
}

/** Forgets every cached file. For tests. */
export function clearParquetCache() {
  cache.clear();
}
