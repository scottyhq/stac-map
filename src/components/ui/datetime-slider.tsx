import { Slider } from "@chakra-ui/react";
import { useState } from "react";

export interface DatetimeSliderTick {
  value: number;
  /** Ticks outside the selected range are dimmed. */
  inRange?: boolean;
}

export default function DatetimeSlider({
  startBoundMs,
  endBoundMs,
  value,
  onChangeEnd,
  onValueChange,
  ticks,
  indicator,
  orientation = "horizontal",
}: {
  startBoundMs: number;
  endBoundMs: number;
  value: [number, number];
  onChangeEnd: (value: [number, number]) => void;
  /** Called continuously while dragging, e.g. to show live labels. */
  onValueChange?: (value: [number, number]) => void;
  /** Small marks on the track, e.g. the items available at one place. */
  ticks?: DatetimeSliderTick[];
  /** A highlighted mark on the track, e.g. the datetime of the selected item. */
  indicator?: number | null;
  orientation?: "horizontal" | "vertical";
}) {
  const [internal, setInternal] = useState<number[]>([value[0], value[1]]);
  const [lastExternal, setLastExternal] = useState<number[]>([
    value[0],
    value[1],
  ]);
  if (lastExternal[0] !== value[0] || lastExternal[1] !== value[1]) {
    setLastExternal([value[0], value[1]]);
    setInternal([value[0], value[1]]);
  }
  const min = startBoundMs;
  const max = endBoundMs > startBoundMs ? endBoundMs : startBoundMs + 1;
  const clamp = (x: number) => Math.min(Math.max(x, min), max);
  const clamped = [clamp(internal[0]), clamp(internal[1])];
  const vertical = orientation === "vertical";
  const showIndicator =
    indicator !== null &&
    indicator !== undefined &&
    indicator >= min &&
    indicator <= max;
  const indicatorInRange =
    showIndicator && indicator >= clamped[0] && indicator <= clamped[1];

  return (
    <Slider.Root
      size={"sm"}
      orientation={orientation}
      min={min}
      max={max}
      value={clamped}
      onValueChange={(e) => {
        setInternal(e.value);
        onValueChange?.([e.value[0], e.value[1]]);
      }}
      onValueChangeEnd={(e) => onChangeEnd([e.value[0], e.value[1]])}
      h={vertical ? "100%" : undefined}
    >
      <Slider.Control>
        <Slider.Track>
          <Slider.Range />
        </Slider.Track>
        {((ticks && ticks.length > 0) || showIndicator) && (
          <Slider.MarkerGroup pointerEvents={"none"}>
            {ticks
              ?.filter((tick) => tick.value >= min && tick.value <= max)
              .map((tick, i) => (
                <Slider.Marker key={`${tick.value}-${i}`} value={tick.value}>
                  <Slider.MarkerIndicator
                    bg={tick.inRange === false ? "fg.subtle/50" : "fg"}
                    rounded={"none"}
                    // A rug beside the track, so the track stays readable
                    {...(vertical
                      ? { w: "2", h: "2px", ms: "-16px" }
                      : { h: "2", w: "2px", mt: "-16px" })}
                  />
                </Slider.Marker>
              ))}
            {showIndicator && (
              <Slider.Marker value={indicator}>
                <Slider.MarkerIndicator
                  data-testid={"datetime-slider-indicator"}
                  boxSize={"3"}
                  {...(vertical ? { ms: "-1" } : { mt: "-1" })}
                  bg={indicatorInRange ? "orange.solid" : "bg"}
                  borderWidth={"2px"}
                  borderColor={"orange.solid"}
                  shadow={"sm"}
                />
              </Slider.Marker>
            )}
          </Slider.MarkerGroup>
        )}
        <Slider.Thumbs />
      </Slider.Control>
    </Slider.Root>
  );
}
