import {
  useStacGeoparquetAssetHrefs,
  useStacGeoparquetAssetKeys,
  useStacGeoparquetCount,
  useStacGeoparquetItems,
} from "@/hooks/stac";
import { useStore } from "@/store";
import { msToIsoLabel } from "@/utils/datetime";
import {
  buildDuckdbCommand,
  buildRustacCommand,
  buildStacAssetCommand,
  clampBbox,
  downloadFilterToWhere,
  toUrlList,
  visualizedAssetKey,
  type DownloadFilter,
} from "@/utils/download-items";
import {
  buildStackVrt,
  crsToLonLatBounds,
  getVrtBands,
  getVrtWindow,
  lonLatToCrsBounds,
  type Bounds,
} from "@/utils/vrt";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Clipboard,
  CloseButton,
  Code,
  Dialog,
  DownloadTrigger,
  HStack,
  IconButton,
  Portal,
  RadioGroup,
  Spinner,
  Stack,
  Tabs,
  Text,
} from "@chakra-ui/react";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { LuDownload, LuLayers, LuList, LuTerminal } from "react-icons/lu";

/**
 * "Download items" for a stac-geoparquet file: exports the asset hrefs of the
 * items in the current map view and time slider range, or
 * shows equivalent `duckdb` / `rustac` commands to run in a terminal.
 */
export default function DownloadItemsButton() {
  const href = useStore((store) => store.href);
  const hrefIsParquet = useStore((store) => store.hrefIsParquet);
  const connection = useStore((store) => store.connection);
  if (!href || !hrefIsParquet || !connection) return null;
  return (
    <Dialog.Root size={"lg"} lazyMount unmountOnExit>
      <Dialog.Trigger asChild>
        <IconButton
          variant={"surface"}
          bg={"bg.muted/90"}
          aria-label={"Download items"}
          title={"Download items"}
        >
          <LuDownload />
        </IconButton>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Download items</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <DownloadItemsBody href={href} connection={connection} />
            </Dialog.Body>
            <Dialog.CloseTrigger asChild>
              <CloseButton size={"sm"} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function DownloadItemsBody({
  href,
  connection,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
}) {
  const datetimeFilter = useStore((store) => store.datetimeFilters[href]);
  const datetimeExtent = useStore((store) => store.datetimeExtents.geoparquet);
  const mapBbox = useStore((store) => store.mapBbox);
  const visualization = useStore((store) => store.visualization);
  const hivePartitioning = useStore((store) => store.hivePartitioning);

  const filter = useMemo<DownloadFilter>(
    () => ({
      datetime: datetimeFilter,
      bbox: mapBbox ? clampBbox(mapBbox) : undefined,
    }),
    [datetimeFilter, mapBbox]
  );
  const where = useMemo(() => downloadFilterToWhere(filter), [filter]);

  const assetKeysResult = useStacGeoparquetAssetKeys({ href, connection });
  const assetKeys = useMemo(
    () => assetKeysResult.data ?? [],
    [assetKeysResult.data]
  );
  // Until the user picks, default to the asset shown on the map, else "data",
  // else the first asset.
  const [picked, setPicked] = useState<string[] | null>(null);
  const selectedKeys = useMemo(() => {
    if (picked) return assetKeys.filter((key) => picked.includes(key));
    const fallback =
      visualizedAssetKey(visualization, assetKeys) ??
      (assetKeys.includes("data") ? "data" : assetKeys[0]);
    return fallback ? [fallback] : [];
  }, [picked, assetKeys, visualization]);
  const toggleKey = (key: string, checked: boolean) =>
    setPicked(
      checked
        ? [...selectedKeys, key]
        : selectedKeys.filter((selected) => selected !== key)
    );

  const count = useStacGeoparquetCount({ href, connection, where });
  const range = datetimeFilter ?? datetimeExtent;

  return (
    <Stack gap={4} fontSize={"sm"}>
      <Stack gap={1}>
        <Text>
          <strong>
            {count.data === undefined ? "…" : count.data.toLocaleString()}
          </strong>{" "}
          item{count.data === 1 ? "" : "s"}
          {range && (
            <>
              {" "}
              from <strong>{msToIsoLabel(range[0])}</strong> to{" "}
              <strong>{msToIsoLabel(range[1])}</strong>
            </>
          )}
          {mapBbox && " in the current map view"}
        </Text>
        <Text color={"fg.muted"} fontSize={"xs"}>
          Pan and zoom the map, and drag the time slider, to change which items
          are included.
        </Text>
      </Stack>

      <Stack gap={2}>
        <Text fontWeight={"medium"}>Assets</Text>
        {assetKeysResult.isLoading ? (
          <Spinner size={"sm"} />
        ) : assetKeys.length === 0 ? (
          <Text color={"fg.muted"}>No assets column in this file.</Text>
        ) : (
          <HStack wrap={"wrap"} gap={3}>
            {assetKeys.map((key) => (
              <Checkbox.Root
                key={key}
                size={"sm"}
                checked={selectedKeys.includes(key)}
                onCheckedChange={(e) => toggleKey(key, !!e.checked)}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{key}</Checkbox.Label>
              </Checkbox.Root>
            ))}
          </HStack>
        )}
      </Stack>

      <Tabs.Root defaultValue={"urls"} size={"sm"} variant={"line"} lazyMount>
        <Tabs.List>
          <Tabs.Trigger value={"urls"}>
            <LuList /> URL list
          </Tabs.Trigger>
          <Tabs.Trigger value={"cli"}>
            <LuTerminal /> Command line
          </Tabs.Trigger>
          <Tabs.Trigger value={"vrt"}>
            <LuLayers /> VRT
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value={"urls"}>
          <UrlList
            href={href}
            connection={connection}
            where={where}
            assetKeys={selectedKeys}
          />
        </Tabs.Content>
        <Tabs.Content value={"cli"}>
          <Commands
            href={href}
            assetKeys={selectedKeys}
            filter={filter}
            hivePartitioning={hivePartitioning}
          />
        </Tabs.Content>
        <Tabs.Content value={"vrt"}>
          <Vrt
            href={href}
            connection={connection}
            where={where}
            assetKeys={selectedKeys}
            mapView={filter.bbox}
          />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

const PREVIEW_LINES = 5;

function UrlList({
  href,
  connection,
  where,
  assetKeys,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  where?: string;
  assetKeys: string[];
}) {
  const result = useStacGeoparquetAssetHrefs({
    href,
    connection,
    where,
    assetKeys,
  });
  const hrefs = result.data ?? [];
  const text = toUrlList(hrefs);
  const allHttp = hrefs.every((h) => /^https?:/i.test(h.href));
  const preview = hrefs
    .slice(0, PREVIEW_LINES)
    .map((h) => h.href)
    .join("\n");

  if (assetKeys.length === 0)
    return <Text color={"fg.muted"}>Pick at least one asset.</Text>;
  if (result.error)
    return <Text color={"fg.error"}>{result.error.message}</Text>;

  return (
    <Stack gap={3}>
      <HStack gap={2}>
        <DownloadTrigger
          fileName={"urls.txt"}
          mimeType={"text/plain"}
          data={() => text}
          asChild
        >
          <Button size={"xs"} disabled={!hrefs.length}>
            <LuDownload /> urls.txt
          </Button>
        </DownloadTrigger>
        <Clipboard.Root value={text}>
          <Clipboard.Trigger asChild>
            <Button size={"xs"} variant={"surface"} disabled={!hrefs.length}>
              <Clipboard.Indicator /> Copy
            </Button>
          </Clipboard.Trigger>
        </Clipboard.Root>
        {result.isFetching ? (
          <Spinner size={"xs"} />
        ) : (
          <Badge>
            {hrefs.length.toLocaleString()} URL{hrefs.length === 1 ? "" : "s"}
          </Badge>
        )}
      </HStack>
      {hrefs.length > 0 && (
        <Pre>
          {preview}
          {hrefs.length > PREVIEW_LINES &&
            `\n… and ${(hrefs.length - PREVIEW_LINES).toLocaleString()} more`}
        </Pre>
      )}
      {hrefs.length > 0 && (
        <Text color={"fg.muted"} fontSize={"xs"}>
          {allHttp ? (
            <>
              Then fetch them with <Code size={"sm"}>wget -i urls.txt</Code>.
            </>
          ) : (
            <>
              Some hrefs aren't HTTP(S) (e.g. <Code size={"sm"}>s3://</Code>);
              use a tool like <Code size={"sm"}>aws s3 cp</Code> or{" "}
              <Code size={"sm"}>rclone</Code> for those.
            </>
          )}
        </Text>
      )}
    </Stack>
  );
}

function Commands({
  href,
  assetKeys,
  filter,
  hivePartitioning,
}: {
  href: string;
  assetKeys: string[];
  filter: DownloadFilter;
  hivePartitioning: boolean;
}) {
  if (assetKeys.length === 0)
    return <Text color={"fg.muted"}>Pick at least one asset.</Text>;
  const isLocal = !/^[a-z][a-z0-9+.-]*:\/\//i.test(href);
  return (
    <Stack gap={4}>
      {isLocal && (
        <Text color={"fg.warning"} fontSize={"xs"}>
          This file was opened from your computer; replace <code>{href}</code>{" "}
          with its path.
        </Text>
      )}
      <Command
        title={"DuckDB"}
        note={"Same query stac-map runs, so the list matches exactly."}
        command={buildDuckdbCommand({
          href,
          assetKeys,
          filter,
          hivePartitioning,
        })}
      />
      <Command
        title={"rustac + jq"}
        note={
          "rustac matches time ranges on start_datetime/end_datetime when items have them, so interval items (mosaics, composites) can differ from the slider."
        }
        command={buildRustacCommand({ href, assetKeys, filter })}
      />
      <Command
        title={"Download files (rustac + stac-asset)"}
        note={
          "Downloads the assets into ./items and writes an item collection that points at the local copies. Same time-range caveat as above. Files can be large."
        }
        command={buildStacAssetCommand({ href, assetKeys, filter })}
      />
    </Stack>
  );
}

function Vrt({
  href,
  connection,
  where,
  assetKeys,
  mapView,
}: {
  href: string;
  connection: AsyncDuckDBConnection;
  where?: string;
  assetKeys: string[];
  /** The lon/lat map view to crop to (the full extent if unknown). */
  mapView?: Bounds;
}) {
  const items = useStacGeoparquetItems({ href, connection, where });
  // One band per item, so a stack only makes sense for one asset at a time.
  const [picked, setPicked] = useState<string | null>(null);
  const assetKey = picked && assetKeys.includes(picked) ? picked : assetKeys[0];

  const stack = useMemo(() => {
    if (!items.data || !assetKey) return undefined;
    const { bands, skipped } = getVrtBands(items.data, [assetKey]);
    const crs = bands[0]?.grid.crs;
    const sameCrs = bands.filter((band) => band.grid.crs === crs);
    return {
      bands: sameCrs,
      crs,
      skipped: skipped + bands.length - sameCrs.length,
    };
  }, [items.data, assetKey]);

  const reference = stack?.bands[0]?.grid;
  const crop = useQuery({
    queryKey: ["vrt-crop", reference?.crs, mapView],
    queryFn: () => lonLatToCrsBounds(reference!.crs, mapView!),
    enabled: !!reference && !!mapView,
    staleTime: Infinity,
  });

  const vrtWindow = useMemo(() => {
    if (!stack || !reference || (mapView && !crop.data)) return undefined;
    return getVrtWindow(
      reference,
      stack.bands.map((band) => band.grid.bounds),
      mapView ? crop.data : undefined
    );
  }, [stack, reference, mapView, crop.data]);

  const lonLat = useQuery({
    queryKey: ["vrt-lonlat", vrtWindow?.crs, vrtWindow?.bounds],
    queryFn: () => crsToLonLatBounds(vrtWindow!.crs, vrtWindow!.bounds),
    enabled: !!vrtWindow,
    staleTime: Infinity,
  });

  if (!assetKey) return <Text color={"fg.muted"}>Pick an asset.</Text>;
  const assetPicker = assetKeys.length > 1 && (
    <RadioGroup.Root
      size={"sm"}
      value={assetKey}
      onValueChange={(e) => e.value && setPicked(e.value)}
    >
      <HStack gap={3} wrap={"wrap"} fontSize={"sm"}>
        <Text color={"fg.muted"}>One asset per VRT:</Text>
        {assetKeys.map((key) => (
          <RadioGroup.Item key={key} value={key}>
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>{key}</RadioGroup.ItemText>
          </RadioGroup.Item>
        ))}
      </HStack>
    </RadioGroup.Root>
  );
  if (items.error || crop.error)
    return (
      <Text color={"fg.error"}>{(items.error ?? crop.error)?.message}</Text>
    );
  if (!stack || (mapView && !crop.data))
    return (
      <Stack gap={3}>
        {assetPicker}
        <Spinner size={"sm"} />
      </Stack>
    );
  if (stack.bands.length === 0 || !vrtWindow)
    return (
      <Stack gap={3}>
        {assetPicker}
        <Text color={"fg.muted"}>
          {stack.bands.length === 0 ? (
            <>
              {assetKey} has no <Code size={"sm"}>proj:transform</Code> /{" "}
              <Code size={"sm"}>proj:shape</Code> / EPSG code, which a VRT
              needs.
            </>
          ) : (
            "The map view doesn't overlap the data."
          )}
        </Text>
      </Stack>
    );

  const stem = (href.split("/").pop() ?? "items").replace(/\.parquet$/i, "");
  const fileName = `${stem}-${assetKey}.vrt`;
  const bytes =
    stack.bands.length *
    vrtWindow.width *
    vrtWindow.height *
    bytesPerPixel(reference!.dataType);
  const fmt = (v: number) => Number(v.toFixed(4)).toString();
  const res =
    vrtWindow.resX === vrtWindow.resY
      ? `${vrtWindow.resX}`
      : `${vrtWindow.resX} × ${vrtWindow.resY}`;

  return (
    <Stack gap={3}>
      {assetPicker}
      <HStack gap={2}>
        <DownloadTrigger
          fileName={fileName}
          mimeType={"application/xml"}
          data={() => buildStackVrt(stack.bands, vrtWindow)}
          asChild
        >
          <Button size={"xs"}>
            <LuDownload /> {fileName}
          </Button>
        </DownloadTrigger>
        <Badge>
          {stack.bands.length} band{stack.bands.length === 1 ? "" : "s"}
        </Badge>
      </HStack>
      <Box
        as={"dl"}
        fontSize={"xs"}
        display={"grid"}
        gridTemplateColumns={"auto 1fr"}
        columnGap={3}
        rowGap={1}
      >
        <Text as={"dt"} color={"fg.muted"}>
          Extent (lon, lat)
        </Text>
        <Text as={"dd"} fontFamily={"mono"}>
          {lonLat.data ? lonLat.data.map(fmt).join(", ") : "…"}
        </Text>
        <Text as={"dt"} color={"fg.muted"}>
          Extent ({vrtWindow.crs})
        </Text>
        <Text as={"dd"} fontFamily={"mono"}>
          {vrtWindow.bounds.join(", ")}
        </Text>
        <Text as={"dt"} color={"fg.muted"}>
          Grid
        </Text>
        <Text as={"dd"}>
          {vrtWindow.width.toLocaleString()} ×{" "}
          {vrtWindow.height.toLocaleString()} px at {res} units,{" "}
          {reference!.dataType} (≈ {formatBytes(bytes)} if exported
          uncompressed)
        </Text>
        <Text as={"dt"} color={"fg.muted"}>
          Bands
        </Text>
        <Text as={"dd"}>One per item, oldest first, named by date</Text>
      </Box>
      {stack.skipped > 0 && (
        <Text color={"fg.warning"} fontSize={"xs"}>
          Skipped {stack.skipped} item{stack.skipped === 1 ? "" : "s"} without
          projection metadata or in a different CRS from {stack.crs}.
        </Text>
      )}
      <Text color={"fg.muted"} fontSize={"xs"}>
        {mapView
          ? "Cropped to the current map view, in the data's native projection. "
          : "Full extent of the items, in their native projection. "}
        The VRT points at the remote files, so nothing downloads until you read
        it. Try <Code size={"sm"}>gdal raster info {fileName}</Code>, open it in
        QGIS, or{" "}
        <Code size={"sm"}>rioxarray.open_rasterio(&quot;{fileName}&quot;)</Code>
        .
      </Text>
    </Stack>
  );
}

function bytesPerPixel(dataType: string): number {
  const bits = Number(dataType.match(/\d+/)?.[0] ?? 8);
  return (dataType.startsWith("C") ? 2 : 1) * Math.max(1, bits / 8);
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(bytes < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function Command({
  title,
  note,
  command,
}: {
  title: string;
  note: string;
  command: string;
}) {
  return (
    <Stack gap={1}>
      <HStack justify={"space-between"}>
        <Text fontWeight={"medium"}>{title}</Text>
        <Clipboard.Root value={command}>
          <Clipboard.Trigger asChild>
            <IconButton
              size={"2xs"}
              variant={"ghost"}
              aria-label={`Copy ${title} command`}
            >
              <Clipboard.Indicator />
            </IconButton>
          </Clipboard.Trigger>
        </Clipboard.Root>
      </HStack>
      <Pre>{command}</Pre>
      <Text color={"fg.muted"} fontSize={"xs"}>
        {note}
      </Text>
    </Stack>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <Box
      as={"pre"}
      fontSize={"xs"}
      fontFamily={"mono"}
      bg={"bg.muted"}
      p={2}
      rounded={"sm"}
      overflowX={"auto"}
      whiteSpace={"pre"}
    >
      {children}
    </Box>
  );
}
