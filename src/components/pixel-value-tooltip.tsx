import { useStore } from "@/store";
import { formatPixelValue } from "@/utils/pixel-sampler";
import { Box } from "@chakra-ui/react";
import type { MapMouseEvent } from "maplibre-gl";
import { useEffect, useState } from "react";
import { useMap } from "react-map-gl/maplibre";

type Readout = { x: number; y: number; text: string };

/**
 * Shows the visualized single-band COG's value under the cursor. Rendered as a
 * child of the map, so mouse moves don't re-render the map itself.
 */
export default function PixelValueTooltip() {
  const { current: mapRef } = useMap();
  const pixelSampler = useStore((store) => store.pixelSampler);
  const [readout, setReadout] = useState<Readout | null>(null);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !pixelSampler) return;
    const onMove = (e: MapMouseEvent) => {
      const sample = pixelSampler.sample(e.lngLat.lng, e.lngLat.lat);
      if (!sample) {
        setReadout(null);
        return;
      }
      const text =
        sample.level === 0
          ? formatPixelValue(sample.value)
          : `≈ ${formatPixelValue(sample.value)}`;
      setReadout({ x: e.point.x, y: e.point.y, text });
    };
    const onOut = () => setReadout(null);
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);
    return () => {
      map.off("mousemove", onMove);
      map.off("mouseout", onOut);
      setReadout(null);
    };
  }, [mapRef, pixelSampler]);

  if (!readout || !pixelSampler) return null;
  return (
    <Box
      position="absolute"
      left={`${readout.x + 12}px`}
      top={`${readout.y + 12}px`}
      pointerEvents="none"
      bg="bg.panel"
      color="fg"
      fontSize="xs"
      fontFamily="mono"
      px={2}
      py={1}
      rounded="sm"
      shadow="sm"
      // Above deck.gl's overlay container, which sits at z-index 2.
      zIndex={3}
    >
      {readout.text}
    </Box>
  );
}
