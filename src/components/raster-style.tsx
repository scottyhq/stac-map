import { useStore } from "@/store";
import {
  COLORMAP_NAMES,
  colormapGradient,
  formatValue,
  isColormapName,
  legendTicks,
  type ColormapName,
} from "@/utils/colormap";
import {
  logScaleRange,
  type BandRange,
  type RasterScale,
} from "@/utils/single-band";
import {
  Box,
  Checkbox,
  HStack,
  IconButton,
  Input,
  Portal,
  SegmentGroup,
  Select,
  Stack,
  Text,
  createListCollection,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuRotateCcw } from "react-icons/lu";

const GREYSCALE = "greyscale";

const colormapCollection = createListCollection({
  items: [GREYSCALE, ...COLORMAP_NAMES].map((name) => ({
    label: name,
    value: name,
  })),
});

/**
 * Colormap, scale and value range controls for a single-band raster, with a
 * legend. `autoRange` is the range from statistics, shown until the user sets
 * their own; leave it undefined when each item has its own range.
 */
export default function RasterStyleControls({
  autoRange,
  whiteIsZero = false,
  disabled,
}: {
  autoRange: BandRange | undefined;
  /** The raster is MinIsWhite, so greyscale runs white to black. */
  whiteIsZero?: boolean;
  disabled?: boolean;
}) {
  const style = useStore((store) => store.rasterStyle);
  const setStyle = useStore((store) => store.setRasterStyle);
  const rasterRange = useStore((store) => store.rasterRange);
  const setRasterRange = useStore((store) => store.setRasterRange);

  const range = rasterRange ?? autoRange;
  const logRange =
    range && style.scale === "log" ? logScaleRange(range) : undefined;
  const shownRange = logRange ?? range;

  const commit = (bound: "min" | "max", value: number | undefined) => {
    const base = rasterRange ?? autoRange;
    if (value === undefined) return;
    const next = {
      min: bound === "min" ? value : (base?.min ?? value),
      max: bound === "max" ? value : (base?.max ?? value),
    };
    setRasterRange(next);
  };

  return (
    <Stack gap={2} fontSize={"xs"}>
      <HStack gap={2}>
        <Select.Root
          size={"xs"}
          flex={1}
          collection={colormapCollection}
          value={[style.colormap ?? GREYSCALE]}
          onValueChange={(e) => {
            const value = e.value[0];
            setStyle({ colormap: isColormapName(value) ? value : null });
          }}
          disabled={disabled}
        >
          <Select.HiddenSelect />
          <Select.Label srOnly>Colormap</Select.Label>
          <Select.Control>
            <Select.Trigger>
              <Select.ValueText placeholder={"Colormap"} />
            </Select.Trigger>
            <Select.IndicatorGroup>
              <Select.Indicator />
            </Select.IndicatorGroup>
          </Select.Control>
          <Portal>
            <Select.Positioner>
              <Select.Content>
                {colormapCollection.items.map((item) => (
                  <Select.Item key={item.value} item={item}>
                    <HStack gap={2} flex={1}>
                      <Box
                        w={12}
                        h={2.5}
                        borderRadius={"xs"}
                        flexShrink={0}
                        style={{
                          background: gradient(
                            isColormapName(item.value) ? item.value : null,
                            false
                          ),
                        }}
                      />
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </HStack>
                    <Select.ItemIndicator />
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Positioner>
          </Portal>
        </Select.Root>
        <Checkbox.Root
          size={"xs"}
          checked={style.reversed}
          onCheckedChange={(e) => setStyle({ reversed: !!e.checked })}
          disabled={disabled}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>reverse</Checkbox.Label>
        </Checkbox.Root>
      </HStack>

      <HStack gap={2}>
        <SegmentGroup.Root
          size={"xs"}
          value={style.scale}
          onValueChange={(e) => {
            if (e.value === "linear" || e.value === "log") {
              setStyle({ scale: e.value as RasterScale });
            }
          }}
          disabled={disabled}
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Items items={["linear", "log"]} />
        </SegmentGroup.Root>
        <RangeInput
          label={"min"}
          value={rasterRange?.min}
          placeholder={autoRange?.min}
          onCommit={(value) => commit("min", value)}
          disabled={disabled}
        />
        <RangeInput
          label={"max"}
          value={rasterRange?.max}
          placeholder={autoRange?.max}
          onCommit={(value) => commit("max", value)}
          disabled={disabled}
        />
        <IconButton
          size={"2xs"}
          variant={"ghost"}
          aria-label={"Reset range"}
          title={"Reset range to statistics"}
          onClick={() => setRasterRange(null)}
          disabled={disabled || !rasterRange}
        >
          <LuRotateCcw />
        </IconButton>
      </HStack>

      <Stack gap={0.5}>
        <Box
          h={2.5}
          borderRadius={"xs"}
          style={{
            background: gradient(
              style.colormap,
              style.colormap ? style.reversed : style.reversed !== whiteIsZero
            ),
          }}
        />
        <HStack justify={"space-between"} color={"fg.muted"}>
          {shownRange ? (
            legendTicks(shownRange, style.scale === "log" && !!logRange).map(
              (tick, i) => <Text key={i}>{formatValue(tick)}</Text>
            )
          ) : (
            <Text>range: per item statistics</Text>
          )}
        </HStack>
        {style.scale === "log" && range && !logRange && (
          <Text color={"fg.warning"}>
            A log scale needs a positive maximum; showing linear.
          </Text>
        )}
        {style.scale === "log" && range && logRange && range.min <= 0 && (
          <Text color={"fg.muted"}>
            min ≤ 0 is not valid on a log scale; using{" "}
            {formatValue(logRange.min)}.
          </Text>
        )}
      </Stack>
    </Stack>
  );
}

function RangeInput({
  label,
  value,
  placeholder,
  onCommit,
  disabled,
}: {
  label: string;
  value: number | undefined;
  placeholder: number | undefined;
  onCommit: (value: number | undefined) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setText(value === undefined ? "" : String(value));
  }

  const commit = () => {
    if (text.trim() === "") {
      setText(value === undefined ? "" : String(value));
      return;
    }
    const parsed = Number(text);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setText(value === undefined ? "" : String(value));
  };

  return (
    <Input
      size={"2xs"}
      flex={1}
      minW={0}
      inputMode={"decimal"}
      aria-label={label}
      placeholder={
        placeholder === undefined
          ? label
          : `${label} ${formatValue(placeholder)}`
      }
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      disabled={disabled}
    />
  );
}

function gradient(colormap: ColormapName | null, reversed: boolean): string {
  if (colormap) return colormapGradient(colormap, reversed);
  return reversed
    ? "linear-gradient(to right, white, black)"
    : "linear-gradient(to right, black, white)";
}
