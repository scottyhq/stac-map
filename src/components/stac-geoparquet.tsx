import {
  useStacGeoparquetTable,
  useStacGeoparquetTimeline,
  useStacGeoparquetValue,
} from "@/hooks/stac";
import { useStore } from "@/store";
import {
  datetimeFilterToWhere,
  type SupportedGeometryType,
} from "@/utils/stac-geoparquet";
import type { Color } from "@deck.gl/core";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import {
  GeoArrowPathLayer,
  GeoArrowPolygonLayer,
  GeoArrowScatterplotLayer,
} from "@geoarrow/deck.gl-layers";
import type { Table } from "apache-arrow";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorAlert } from "./ui/error-alert";

export default function StacGeoparquet({
  href,
  connection,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
}) {
  const datetimeFilter = useStore((store) => store.datetimeFilters[href]);
  const setDatetimeExtent = useStore((store) => store.setDatetimeExtent);
  const summary = useStacGeoparquetValue({ href, connection });
  const datetimeExtent = summary.data?.datetimeExtent as
    [number, number] | null | undefined;

  useEffect(() => {
    setDatetimeExtent("geoparquet", datetimeExtent ?? null);
    return () => setDatetimeExtent("geoparquet", null);
  }, [datetimeExtent, setDatetimeExtent]);

  const where = useMemo(
    () => datetimeFilterToWhere(datetimeFilter),
    [datetimeFilter]
  );

  // While an item is selected, its footprint and every footprint stacked on it
  // (the same place at other times) sit under the item's raster. Ignore those
  // for hover and click so clicking the image doesn't jump to an arbitrary
  // time; use the slider or arrow keys to step instead.
  const stacGeoparquetId = useStore((store) => store.stacGeoparquetId);
  const timeline = useStacGeoparquetTimeline({
    href,
    connection,
    id: stacGeoparquetId,
  });
  const ignoredIds = useMemo(() => {
    if (!stacGeoparquetId) return EMPTY_IDS;
    const ids = new Set([stacGeoparquetId]);
    if (timeline.data?.some((entry) => entry.id === stacGeoparquetId))
      for (const entry of timeline.data) ids.add(entry.id);
    return ids;
  }, [stacGeoparquetId, timeline.data]);

  const result = useStacGeoparquetTable({ href, connection, where });
  if (result.error)
    return <ErrorAlert title="stac-geoparquet" error={result.error} />;
  if (!result.data?.table || !result.data.geometryType) return null;
  return (
    <StacGeoparquetTable
      table={result.data.table}
      geometryType={result.data.geometryType}
      ignoredIds={ignoredIds}
    />
  );
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

function StacGeoparquetTable({
  table,
  geometryType,
  ignoredIds,
}: {
  table: Table;
  geometryType: SupportedGeometryType;
  ignoredIds: ReadonlySet<string>;
}) {
  const [hoveredId, setHovered] = useState<string>();
  const hovered =
    hoveredId && !ignoredIds.has(hoveredId) ? hoveredId : undefined;
  const selectId = useStore((store) => store.setStacGeoparquetId);
  const setStacGeoparquetId = useCallback(
    (id: string | undefined) => {
      if (id && !ignoredIds.has(id)) selectId(id);
    },
    [ignoredIds, selectId]
  );
  const setLayer = useStore((store) => store.setLayer);
  const lineColor = useStore((store) => store.lineColor);
  const fillColor = useStore((store) => store.fillColor);
  const id = `stac-geoparquet-${geometryType}`;

  const layer = useMemo(() => {
    switch (geometryType) {
      case "point":
        return new GeoArrowScatterplotLayer({
          id,
          data: table,
          getColor: lineColor,
          getRadius: 2,
          getPosition: table.getChild("geometry")!,
          radiusUnits: "pixels",
          pickable: true,
          onHover: (info) => {
            setHovered(info.object?.id);
          },
          onClick: (info) => {
            setStacGeoparquetId(info.object?.id);
          },
        });
      case "polygon":
      case "multipolygon":
        return new GeoArrowPolygonLayer({
          id,
          data: table,
          filled: true,
          getFillColor: ({ index, data }) => {
            const id = data.data.get(index)?.["id"];
            return id === hovered ? fillColor : ([0, 0, 0, 0] as Color);
          },
          getLineColor: lineColor,
          getLineWidth: 2,
          lineWidthUnits: "pixels",
          pickable: true,
          onHover: (info) => {
            setHovered(info.object?.id);
          },
          onClick: (info) => {
            setStacGeoparquetId(info.object?.id);
          },
          updateTriggers: {
            getFillColor: [hovered],
          },
        });
      case "linestring":
        return new GeoArrowPathLayer({
          id,
          data: table,
          getColor: lineColor,
          getWidth: 4,
          widthUnits: "pixels",
          pickable: true,
          onHover: (info) => {
            setHovered(info.object?.id);
          },
          onClick: (info) => {
            setStacGeoparquetId(info.object?.id);
          },
        });
      default:
        return null;
    }
  }, [
    id,
    geometryType,
    table,
    lineColor,
    fillColor,
    hovered,
    setStacGeoparquetId,
  ]);

  useEffect(() => {
    if (!layer) return;
    setLayer(id, layer);
    return () => setLayer(id, undefined);
  }, [id, layer, setLayer]);

  return null;
}
