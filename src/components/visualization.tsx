import { useGeoTIFF, useGeoTIFFBandRange } from "@/hooks/stac";
import { useStore } from "@/store";
import type { StacAssets, StacItemCollection } from "@/types/stac";
import { loadGeoTIFF } from "@/utils/geotiff";
import {
  isSingleBandGreyscale,
  renderTileTriggers,
  resolveBandRange,
  singleBandPipeline,
  type BandRange,
  type RasterStyle,
  type SingleBandTileData,
} from "@/utils/single-band";
import { getBandCount, getCogHref, sanitizeBbox } from "@/utils/stac";
import {
  Checkbox,
  HStack,
  Portal,
  Select,
  Stack,
  createListCollection,
} from "@chakra-ui/react";
import { Photometric } from "@cogeotiff/core";
import {
  COGLayer,
  MosaicLayer,
  type MosaicSource,
} from "@developmentseed/deck.gl-geotiff";
import { epsgResolver } from "@developmentseed/proj";
import { useEffect, useMemo, useState } from "react";
import { LuEye, LuEyeOff } from "react-icons/lu";
import type { StacAsset, StacItem, StacLink } from "stac-ts";
import RasterStyleControls from "./raster-style";
import Section from "./ui/section";

export default function Visualization({
  links = [],
  assets = {},
  itemPages = [],
}: {
  links?: StacLink[];
  assets?: StacAssets;
  itemPages?: StacItemCollection[];
}) {
  const tilejsonLink = links.find((link) => link.rel === "tilejson");
  const wmtsLink = links.find((link) => link.rel === "wmts");
  const cogAssets = useMemo(
    () =>
      Object.entries(assets)
        .map((entry) => ({
          key: entry[0],
          title: entry[1].title,
          value: getCogHref(entry[1]),
          score: getScore(entry),
        }))
        .filter((asset) => !!asset.value)
        .sort((a, b) => b.score - a.score),
    [assets]
  );

  const allItems = useMemo(
    () =>
      itemPages
        .flatMap((page) => page?.features ?? [])
        .filter((item) => !!item),
    [itemPages]
  );
  const itemAssetKeys = useMemo(() => getValidAssetKeys(allItems), [allItems]);

  const collection = useMemo(() => {
    const items: { label: string; value: string }[] = cogAssets.map(
      (asset) => ({
        label: asset.title ?? asset.key,
        value: `asset:${asset.key}`,
      })
    );
    if (tilejsonLink) {
      items.push({ label: "tilejson", value: "tilejson" });
    }
    if (wmtsLink) {
      items.push({ label: "wmts", value: "wmts" });
    }
    for (const key of itemAssetKeys) {
      items.push({ label: key, value: `items:${key}` });
    }
    return createListCollection({ items });
  }, [cogAssets, tilejsonLink, wmtsLink, itemAssetKeys]);

  const visualization = useStore((store) => store.visualization);
  const setVisualization = useStore((store) => store.setVisualization);

  const validValues = useMemo(
    () => new Set(collection.items.map((item) => item.value)),
    [collection]
  );

  const fallback = useMemo(() => {
    const bestItemKey = pickBestKeyForItems(allItems);
    if (bestItemKey && cogAssets.length === 0 && !tilejsonLink && !wmtsLink) {
      return `items:${bestItemKey}`;
    }
    return collection.items[0]?.value;
  }, [allItems, cogAssets, tilejsonLink, wmtsLink, collection]);

  const selected =
    visualization && validValues.has(visualization) ? visualization : fallback;

  useEffect(() => {
    if (visualization && validValues.has(visualization)) return;
    if (fallback && fallback !== visualization) setVisualization(fallback);
  }, [visualization, validValues, fallback, setVisualization]);

  const [enabled, setEnabled] = useState(true);

  const firstPage = itemPages[0];
  const [lastFirstPage, setLastFirstPage] = useState(firstPage);
  if (lastFirstPage !== firstPage) {
    setLastFirstPage(firstPage);
    const bestItemKey = pickBestKeyForItems(allItems);
    if (bestItemKey) setVisualization(`items:${bestItemKey}`);
  }

  const setLayer = useStore((store) => store.setLayer);
  const setMaplibreLayer = useStore((store) => store.setMaplibreLayer);

  const selectedCogHref = useMemo(() => {
    if (!selected?.startsWith("asset:")) return undefined;
    const asset = assets[selected.slice("asset:".length)];
    return asset && getCogHref(asset);
  }, [selected, assets]);

  const { data: selectedCogGeotiff } = useGeoTIFF(selectedCogHref);

  const selectedAsset = useMemo(() => {
    if (!selected?.startsWith("asset:")) return undefined;
    return assets[selected.slice("asset:".length)];
  }, [selected, assets]);

  const bandRange = useGeoTIFFBandRange({
    href: selectedCogHref,
    geotiff: selectedCogGeotiff,
    asset: selectedAsset,
  });

  const rasterStyle = useStore((store) => store.rasterStyle);
  const rasterRange = useStore((store) => store.rasterRange);
  const range = rasterRange ?? bandRange;

  const showRasterStyle = useMemo(() => {
    if (selected?.startsWith("asset:")) {
      return !!selectedCogGeotiff && isSingleBandGreyscale(selectedCogGeotiff);
    }
    if (selected?.startsWith("items:")) {
      const key = selected.slice("items:".length);
      const asset = allItems.find((item) => item.assets?.[key])?.assets[key];
      return !!asset && getBandCount(asset) === 1;
    }
    return false;
  }, [selected, selectedCogGeotiff, allItems]);

  useEffect(() => {
    if (!enabled || !selected) return;
    if (selected.startsWith("items:")) return;

    if (selected.startsWith("asset:")) {
      if (!selectedCogGeotiff) return;
      const layerId = "visualization";
      const pipeline = singleBandPipeline(
        selectedCogGeotiff,
        range,
        rasterStyle
      );
      setLayer(
        layerId,
        pipeline
          ? new COGLayer<SingleBandTileData>({
              id: layerId,
              geotiff: selectedCogGeotiff,
              ...pipeline,
              updateTriggers: {
                renderTile: renderTileTriggers(range, rasterStyle),
              },
            })
          : new COGLayer({
              id: layerId,
              geotiff: selectedCogGeotiff,
            })
      );
      return () => setLayer(layerId, undefined);
    }

    if (selected === "tilejson" && tilejsonLink) {
      setMaplibreLayer("visualization", {
        source: {
          id: "visualization",
          type: "raster",
          url: tilejsonLink.href,
        },
        layer: {
          id: "visualization",
          type: "raster",
        },
      });
      return () => setMaplibreLayer("visualization", undefined);
    }

    if (selected === "wmts" && wmtsLink) {
      setMaplibreLayer("visualization", {
        source: {
          id: "visualization",
          type: "raster",
          url: wmtsLink.href,
          tileSize: 256,
        },
        layer: {
          id: "visualization",
          type: "raster",
        },
      });
      return () => setMaplibreLayer("visualization", undefined);
    }
  }, [
    enabled,
    selected,
    selectedCogGeotiff,
    range,
    rasterStyle,
    tilejsonLink,
    wmtsLink,
    setLayer,
    setMaplibreLayer,
  ]);

  if (collection.items.length === 0) return null;

  return (
    <>
      {enabled &&
        selected?.startsWith("items:") &&
        itemPages.map((page, index) => (
          <PageLayer
            key={index}
            page={page}
            pageIndex={index}
            assetKey={selected.slice("items:".length)}
            rasterStyle={rasterStyle}
            rasterRange={rasterRange}
          />
        ))}
      <Section icon={enabled ? <LuEye /> : <LuEyeOff />} title="Visualization">
        <Stack gap={3}>
          <HStack gap={4}>
            <Checkbox.Root
              checked={enabled}
              onCheckedChange={(e) => setEnabled(!!e.checked)}
              size={"sm"}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
            </Checkbox.Root>
            <Select.Root
              size={"sm"}
              collection={collection}
              value={selected ? [selected] : []}
              onValueChange={(e) => setVisualization(e.value[0] ?? null)}
              disabled={!enabled}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder={"Select a visualization"} />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator />
                </Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    {collection.items.map((item) => (
                      <Select.Item key={item.value} item={item}>
                        <Select.ItemText>{item.label}</Select.ItemText>
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </HStack>
          {showRasterStyle && (
            <RasterStyleControls
              autoRange={selected?.startsWith("asset:") ? bandRange : undefined}
              whiteIsZero={
                selected?.startsWith("asset:") &&
                selectedCogGeotiff?.cachedPrimaryImageTags.photometric ===
                  Photometric.MinIsWhite
              }
              disabled={!enabled}
            />
          )}
        </Stack>
      </Section>
    </>
  );
}

function PageLayer({
  page,
  pageIndex,
  assetKey,
  rasterStyle,
  rasterRange,
}: {
  page: StacItemCollection;
  pageIndex: number;
  assetKey: string;
  rasterStyle: RasterStyle;
  rasterRange: BandRange | null;
}) {
  const setLayer = useStore((store) => store.setLayer);
  const sources = useMemo(() => {
    return (page?.features ?? [])
      .map((item) => {
        item.bbox = item.bbox && (sanitizeBbox(item.bbox) as number[]);
        const asset = item.assets[assetKey];
        const cogHref = asset && getCogHref(asset);
        if (cogHref) item.assets.cog = { href: cogHref };
        return item;
      })
      .filter(
        (item): item is StacItem & MosaicSource =>
          !!item.bbox && !!item.assets.cog
      );
  }, [page, assetKey]);

  useEffect(() => {
    // MosaicLayer (deck.gl-geotiff 0.9) caches each item's sublayers and has no
    // way to pass `updateTriggers` through, so a new style needs a new layer.
    // Unlike a single asset, this refetches the items' tiles.
    const styleKey = JSON.stringify(
      renderTileTriggers(rasterRange ?? undefined, rasterStyle)
    );
    const id = `visualization-page-${pageIndex}-${assetKey}-${styleKey}`;
    if (sources.length === 0) {
      setLayer(id, undefined);
      return;
    }
    setLayer(
      id,
      new MosaicLayer({
        id,
        sources,
        getSource: async (source) => loadGeoTIFF(source.assets.cog.href),
        renderSource: (source, { data, signal }) => {
          if (!data) return null;
          const href = source.assets.cog.href;
          const range =
            rasterRange ?? resolveBandRange(source.assets[assetKey], data);
          const pipeline = singleBandPipeline(data, range, rasterStyle);
          return pipeline
            ? new COGLayer<SingleBandTileData>({
                id: `cog-${href}`,
                epsgResolver,
                geotiff: data,
                signal,
                ...pipeline,
              })
            : new COGLayer({
                id: `cog-${href}`,
                epsgResolver,
                geotiff: data,
                signal,
              });
        },
      })
    );
    return () => setLayer(id, undefined);
  }, [sources, pageIndex, assetKey, rasterStyle, rasterRange, setLayer]);

  return null;
}

function getValidAssetKeys(items: StacItem[]): string[] {
  const keys = new Set<string>();
  for (const item of items) {
    const assets = item.assets as StacAssets | undefined;
    if (!assets) continue;
    for (const [key, asset] of Object.entries(assets)) {
      if (getCogHref(asset)) keys.add(key);
    }
  }
  return [...keys].sort();
}

function pickBestKeyForItems(items: StacItem[]): string | undefined {
  if (items.length === 0) return undefined;
  const counts = new Map<string, number>();
  const hasVisualRole = new Set<string>();
  for (const item of items) {
    const assets = item.assets as StacAssets | undefined;
    if (!assets) continue;
    for (const [key, asset] of Object.entries(assets)) {
      if (!getCogHref(asset)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (asset.roles?.includes("visual")) hasVisualRole.add(key);
    }
  }
  if (counts.size === 0) return undefined;
  const score = (key: string) =>
    (key === "visual" ? 2 : 0) +
    (hasVisualRole.has(key) ? 1 : 0) +
    (counts.get(key) ?? 0) / items.length;
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const key of counts.keys()) {
    const s = score(key);
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  return best;
}

function getScore([key, asset]: [string, StacAsset]) {
  return (key === "visual" ? 2 : 0) + (asset.roles?.includes("visual") ? 1 : 0);
}
