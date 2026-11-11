import { useStacGeoparquetTimeline } from "@/hooks/stac";
import { useStore } from "@/store";
import { msToIsoLabel } from "@/utils/datetime";
import { Box, Button, HStack, Stack, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuX } from "react-icons/lu";
import DatetimeSlider, { type DatetimeSliderTick } from "./ui/datetime-slider";

export default function DatetimeFilter() {
  const href = useStore((store) => store.href);
  const extents = useStore((store) => store.datetimeExtents);
  const filters = useStore((store) => store.datetimeFilters);
  const setFilter = useStore((store) => store.setDatetimeFilter);
  const selected = useSelectedTimeline(href);

  const extent = useMemo<[number, number] | null>(() => {
    const xs = [extents.items, extents.collections, extents.geoparquet].filter(
      (x): x is [number, number] => x !== null
    );
    if (xs.length === 0) return null;
    return [Math.min(...xs.map((x) => x[0])), Math.max(...xs.map((x) => x[1]))];
  }, [extents]);

  // Labels follow the thumbs while dragging; the filter (and the query it
  // drives) only updates on release.
  const [dragging, setDragging] = useState<[number, number] | null>(null);

  if (!href || !extent || extent[1] <= extent[0]) return null;
  const filter: [number, number] = filters[href] ?? extent;
  const isDirty = filter[0] !== extent[0] || filter[1] !== extent[1];
  const shown = dragging ?? filter;

  const ticks: DatetimeSliderTick[] | undefined = selected?.timeline.map(
    (entry) => ({
      value: entry.datetime,
      inRange: entry.datetime >= shown[0] && entry.datetime <= shown[1],
    })
  );

  return (
    <Box
      position={"absolute"}
      right={4}
      top={20}
      bottom={20}
      pointerEvents={"auto"}
      bg={"bg.muted/60"}
      rounded={4}
      p={2}
      zIndex={2}
    >
      <Stack h={"100%"} align={"center"} gap={2}>
        <Text fontSize={"xs"}>{msToIsoLabel(shown[1])}</Text>
        <Box flex={1} minH={"120px"}>
          <DatetimeSlider
            orientation={"vertical"}
            startBoundMs={extent[0]}
            endBoundMs={extent[1]}
            value={filter}
            onValueChange={setDragging}
            onChangeEnd={(v) => {
              setDragging(null);
              setFilter(href, [v[0], v[1]]);
            }}
            ticks={ticks}
            indicator={selected?.datetime}
          />
        </Box>
        <Text fontSize={"xs"}>{msToIsoLabel(shown[0])}</Text>
        {selected && (
          <HStack
            gap={1}
            fontSize={"xs"}
            color={"orange.fg"}
            title={`Selected item (${selected.index + 1} of ${selected.timeline.length} here). Step with ← / →.`}
          >
            <Box boxSize={"2"} rounded={"full"} bg={"orange.solid"} />
            <Text>{msToIsoLabel(selected.datetime)}</Text>
          </HStack>
        )}
        <Button
          size={"xs"}
          variant={"ghost"}
          disabled={!isDirty}
          onClick={() => setFilter(href, undefined)}
          aria-label={"Reset datetime filter"}
        >
          <LuX /> Reset
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * The selected stac-geoparquet item's datetime, plus every item at the same
 * place (its timeline). Null when nothing is selected or it hasn't loaded.
 */
function useSelectedTimeline(href: string | null) {
  const hrefIsParquet = useStore((store) => store.hrefIsParquet);
  const connection = useStore((store) => store.connection);
  const id = useStore((store) => store.stacGeoparquetId);
  const result = useStacGeoparquetTimeline({
    href: hrefIsParquet ? href : null,
    connection,
    id: hrefIsParquet ? id : null,
  });
  return useMemo(() => {
    if (!hrefIsParquet || !id || !result.data) return null;
    // While a new place loads, the previous timeline is kept as placeholder
    // data; only use it if it contains the selected item.
    const index = result.data.findIndex((entry) => entry.id === id);
    if (index === -1) return null;
    return {
      timeline: result.data,
      index,
      datetime: result.data[index].datetime,
    };
  }, [hrefIsParquet, id, result.data]);
}
