import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearParquetCache,
  MAX_CACHED_PARQUET_BYTES,
  MAX_TOTAL_CACHED_PARQUET_BYTES,
  resolveParquetSource,
} from "../../src/utils/parquet-cache";

const HREF = "https://example.com/items.parquet";

function mockConnection() {
  const bindings = {
    registerFileBuffer: vi.fn(async () => {}),
    dropFile: vi.fn(async () => null),
  };
  return {
    connection: { bindings } as unknown as AsyncDuckDBConnection,
    bindings,
  };
}

function respond(length: number | null, { ok = true } = {}) {
  const headers = new Headers();
  if (length !== null) headers.set("Content-Length", String(length));
  return {
    ok,
    headers,
    arrayBuffer: async () => new ArrayBuffer(length ?? 0),
  };
}

describe("resolveParquetSource", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearParquetCache();
    fetchMock = vi.fn(async () => respond(1000));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads a small remote file once and registers it", async () => {
    const { connection, bindings } = mockConnection();
    const [a, b] = await Promise.all([
      resolveParquetSource(connection, HREF, false),
      resolveParquetSource(connection, HREF, false),
    ]);
    expect(a).toMatch(/^stac-map-cache-\d+\.parquet$/);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bindings.registerFileBuffer).toHaveBeenCalledWith(
      a,
      expect.any(Uint8Array)
    );
  });

  it("reads a large file over HTTP and aborts the download", async () => {
    fetchMock.mockImplementation(async () =>
      respond(MAX_CACHED_PARQUET_BYTES + 1)
    );
    const { connection, bindings } = mockConnection();
    expect(await resolveParquetSource(connection, HREF, false)).toBe(HREF);
    const signal = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
      .signal!;
    expect(signal.aborted).toBe(true);
    expect(bindings.registerFileBuffer).not.toHaveBeenCalled();
  });

  it("reads over HTTP when the size is unknown", async () => {
    fetchMock.mockImplementation(async () => respond(null));
    const { connection } = mockConnection();
    expect(await resolveParquetSource(connection, HREF, false)).toBe(HREF);
  });

  it("reads over HTTP when the download fails", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { connection } = mockConnection();
    expect(await resolveParquetSource(connection, HREF, false)).toBe(HREF);
  });

  it("reads over HTTP on an error status", async () => {
    fetchMock.mockImplementation(async () => respond(1000, { ok: false }));
    const { connection } = mockConnection();
    expect(await resolveParquetSource(connection, HREF, false)).toBe(HREF);
  });

  it("leaves hive-partitioned, glob, and local sources alone", async () => {
    const { connection } = mockConnection();
    expect(await resolveParquetSource(connection, HREF, true)).toBe(HREF);
    const glob = "https://example.com/items/**/*.parquet";
    expect(await resolveParquetSource(connection, glob, false)).toBe(glob);
    expect(
      await resolveParquetSource(connection, "upload.parquet", false)
    ).toBe("upload.parquet");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("evicts the oldest files once over the total budget", async () => {
    const size = MAX_CACHED_PARQUET_BYTES;
    fetchMock.mockImplementation(async () => respond(size));
    const { connection, bindings } = mockConnection();
    const count = Math.floor(MAX_TOTAL_CACHED_PARQUET_BYTES / size) + 1;
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      names.push(await resolveParquetSource(connection, `${HREF}?${i}`, false));
    }
    expect(bindings.dropFile).toHaveBeenCalledTimes(1);
    expect(bindings.dropFile).toHaveBeenCalledWith(names[0]);
  });
});
