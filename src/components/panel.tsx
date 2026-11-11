import {
  useStacGeoparquetItem,
  useStacGeoparquetTimeline,
  useStacGeoparquetValue,
  useStacValue,
} from "@/hooks/stac";
import { useStore } from "@/store";
import type { StacValue } from "@/types/stac";
import { getStacId } from "@/utils/stac";
import { getAdjacentTimelineIds } from "@/utils/stac-geoparquet";
import {
  ActionBar,
  Alert,
  Box,
  Button,
  HStack,
  IconButton,
  Link,
  Portal,
  SkeletonText,
  Span,
  Stack,
} from "@chakra-ui/react";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { useEffect, useMemo, type ReactNode } from "react";
import {
  LuBird,
  LuChevronLeft,
  LuChevronRight,
  LuLoader,
  LuX,
} from "react-icons/lu";
import StacGeoparquet from "./stac-geoparquet";
import { StacIcon } from "./ui/stac";
import Value from "./value";

export default function Panel() {
  const href = useStore((store) => store.href);
  const hrefIsParquet = useStore((store) => store.hrefIsParquet);
  const connection = useStore((store) => store.connection);
  return href ? (
    hrefIsParquet ? (
      connection ? (
        <StacGeoparquetHrefPanel href={href} connection={connection} />
      ) : (
        <LoadingDuckdbPanel />
      )
    ) : (
      <HrefPanel href={href} />
    )
  ) : (
    <IntroductionPanel />
  );
}

function HrefPanel({ href }: { href: string }) {
  const result = useStacValue({ href });
  return result.data ? (
    <ValuePanel href={href} value={result.data} />
  ) : result.isLoading ? (
    <LoadingPanel href={href} />
  ) : (
    <ErrorPanel error={result.error} href={href} />
  );
}

function StacGeoparquetHrefPanel({
  href,
  connection,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
}) {
  const result = useStacGeoparquetValue({ href, connection });
  const stacGeoparquetId = useStore((store) => store.stacGeoparquetId);

  // The footprints (and with them the datetime slider) stay mounted while an
  // item is selected, so you can keep scrubbing time and clicking footprints.
  return result.data ? (
    <>
      <StacGeoparquet href={href} connection={connection} />
      {stacGeoparquetId ? (
        <StacGeoparquetItemPanel
          href={href}
          connection={connection}
          id={stacGeoparquetId}
        />
      ) : (
        <ValuePanel href={href} value={result.data} />
      )}
    </>
  ) : result.isLoading ? (
    <LoadingPanel href={href} />
  ) : (
    <ErrorPanel error={result.error} href={href} />
  );
}

function StacGeoparquetItemPanel({
  href,
  connection,
  id,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  id: string;
}) {
  const result = useStacGeoparquetItem({ href, connection, id });
  const timeline = useStacGeoparquetTimeline({ href, connection, id });
  const datetimeFilter = useStore((store) => store.datetimeFilters[href]);
  const setStacGeoparquetId = useStore((store) => store.setStacGeoparquetId);
  const stepStacGeoparquetId = useStore((store) => store.stepStacGeoparquetId);
  const { previous, next } = useMemo(
    () => getAdjacentTimelineIds(timeline.data ?? [], id, datetimeFilter),
    [timeline.data, id, datetimeFilter]
  );

  // Left/right arrows step through time. Listen in the capture phase and stop
  // the event so the map doesn't also pan.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === "ArrowLeft" ? previous : next;
      if (step) stepStacGeoparquetId(step);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [previous, next, stepStacGeoparquetId]);

  return result.data ? (
    <>
      <ValuePanel href={href} value={result.data} />
      <ActionBar.Root open>
        <Portal>
          <ActionBar.Positioner>
            <ActionBar.Content>
              <IconButton
                variant={"outline"}
                size={"sm"}
                disabled={!previous}
                onClick={() => previous && stepStacGeoparquetId(previous)}
                aria-label={"Previous item in time"}
                title={"Previous item in time (←)"}
              >
                <LuChevronLeft />
              </IconButton>
              <ActionBar.SelectionTrigger>{id}</ActionBar.SelectionTrigger>
              <IconButton
                variant={"outline"}
                size={"sm"}
                disabled={!next}
                onClick={() => next && stepStacGeoparquetId(next)}
                aria-label={"Next item in time"}
                title={"Next item in time (→)"}
              >
                <LuChevronRight />
              </IconButton>
              <ActionBar.Separator />
              <Button
                variant={"outline"}
                size={"sm"}
                onClick={() => setStacGeoparquetId(null)}
              >
                <LuX /> Clear selection
              </Button>
            </ActionBar.Content>
          </ActionBar.Positioner>
        </Portal>
      </ActionBar.Root>
    </>
  ) : result.isLoading ? (
    <LoadingPanel href={href} />
  ) : (
    <ErrorPanel error={result.error} href={href} />
  );
}

function ValuePanel({ href, value }: { href: string; value: StacValue }) {
  const header = (
    <PanelHeader icon={<StacIcon value={value} />}>
      {getStacId(value)}
    </PanelHeader>
  );
  return (
    <BasePanel header={header}>
      <Value href={href} value={value} />
    </BasePanel>
  );
}

function LoadingPanel({ href }: { href: string }) {
  const header = <PanelHeader icon={<LuLoader />}>Loading {href}</PanelHeader>;
  return (
    <BasePanel header={header}>
      <SkeletonText h={3} />
    </BasePanel>
  );
}

function LoadingDuckdbPanel() {
  const header = <PanelHeader icon={<LuBird />}>Loading DuckDB...</PanelHeader>;
  return (
    <BasePanel header={header}>
      <SkeletonText h={3} />
    </BasePanel>
  );
}

function ErrorPanel({ error, href }: { error: Error | null; href: string }) {
  return (
    <BasePanel header={"Error loading " + href}>
      <Alert.Root status={"error"}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{error ? error.name : "Unknown error"}</Alert.Title>
          {error && <Alert.Description>{error.message}</Alert.Description>}
        </Alert.Content>
      </Alert.Root>
    </BasePanel>
  );
}

function IntroductionPanel() {
  const body = (
    <Stack fontSize={"sm"} fontWeight={"lighter"}>
      <Box>
        <strong>stac-map</strong> is a map-first visualization tool for{" "}
        <Link variant={"underline"} href="https://stacspec.org">
          STAC
        </Link>
        .
      </Box>
      <Box>
        Questions, issues, or feature requests? Get in touch on{" "}
        <Link asChild>
          <a href="https://github.com/developmentseed/stac-map" target="_blank">
            GitHub
          </a>
        </Link>
        .
      </Box>
    </Stack>
  );
  return <BasePanel header={"stac-map"} children={body} />;
}

function BasePanel({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box
      bg={"bg.muted"}
      pointerEvents={"auto"}
      rounded={4}
      borderColor={"bg.emphasized"}
    >
      <Box
        borderBottomWidth={1}
        borderColor={"border.subtle"}
        py={2}
        px={4}
        fontWeight={"lighter"}
        fontSize={"sm"}
      >
        {header}
      </Box>
      <Box p={4} overflow={"auto"} maxH={"80dvh"}>
        {children}
      </Box>
    </Box>
  );
}

function PanelHeader({
  icon,
  children,
  actions,
}: {
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <HStack>
      {icon}
      <Span flex={1} truncate>
        {children}
      </Span>
      {actions}
    </HStack>
  );
}
