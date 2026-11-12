import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../src/store";

beforeEach(() => {
  useStore.setState({ bookmarks: [] });
});

describe("bookmarks", () => {
  it("starts empty", () => {
    expect(useStore.getState().bookmarks).toEqual([]);
  });

  it("adds a bookmark for an href", () => {
    useStore.getState().addBookmark("https://example.com/catalog.json");
    expect(useStore.getState().bookmarks).toEqual([
      { href: "https://example.com/catalog.json" },
    ]);
  });

  it("does not duplicate a bookmark for the same href", () => {
    useStore.getState().addBookmark("https://example.com/catalog.json");
    useStore.getState().addBookmark("https://example.com/catalog.json");
    expect(useStore.getState().bookmarks).toEqual([
      { href: "https://example.com/catalog.json" },
    ]);
  });

  it("removes a bookmark by href", () => {
    useStore.getState().addBookmark("https://example.com/catalog.json");
    useStore.getState().removeBookmark("https://example.com/catalog.json");
    expect(useStore.getState().bookmarks).toEqual([]);
  });
});

describe("setHref", () => {
  it("clears the selected stac-geoparquet item when the href changes", () => {
    const { setHref, setStacGeoparquetId } = useStore.getState();
    setHref("https://example.com/a.parquet");
    setStacGeoparquetId("item-from-a");
    setHref("https://example.com/b.parquet");
    expect(useStore.getState().stacGeoparquetId).toBeNull();
  });

  it("keeps it when the href is set to the same value", () => {
    const { setHref, setStacGeoparquetId } = useStore.getState();
    setHref("https://example.com/a.parquet");
    setStacGeoparquetId("item-from-a");
    setHref("https://example.com/a.parquet");
    expect(useStore.getState().stacGeoparquetId).toBe("item-from-a");
  });
});
