import { Slider } from "@chakra-ui/react";
import { useRef, useState, type PointerEvent } from "react";

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
  onIndicatorChange,
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
  /**
   * Makes the indicator draggable and in-range ticks clickable. Picking snaps
   * to the nearest in-range tick, and this is called with that tick's value.
   */
  onIndicatorChange?: (value: number) => void;
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

  const controlRef = useRef<HTMLDivElement>(null);
  const lastSnapped = useRef<number | null>(null);
  const dragging = useRef(false);

  // Snap to whichever rendered in-range tick is closest to the pointer, so the
  // indicator lands exactly where the tick is drawn.
  const snapIndicator = (event: PointerEvent<HTMLElement>) => {
    const control = controlRef.current;
    if (!control || !onIndicatorChange) return;
    const pointer = vertical ? event.clientY : event.clientX;
    let best: { value: number; distance: number } | null = null;
    for (const el of control.querySelectorAll<HTMLElement>(
      "[data-tick-value][data-in-range='true']"
    )) {
      const rect = el.getBoundingClientRect();
      const center = vertical
        ? rect.top + rect.height / 2
        : rect.left + rect.width / 2;
      const distance = Math.abs(center - pointer);
      if (!best || distance < best.distance)
        best = { value: Number(el.dataset.tickValue), distance };
    }
    if (best && best.value !== lastSnapped.current) {
      lastSnapped.current = best.value;
      onIndicatorChange(best.value);
    }
  };

  // Pressing the indicator or an in-range tick picks the nearest tick, and
  // dragging keeps picking, without also moving a range thumb.
  const startPick = (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not an active pointer; dragging still works over the mark
    }
    dragging.current = true;
    lastSnapped.current = showIndicator ? indicator : null;
    snapIndicator(event);
  };
  const movePick = (event: PointerEvent<HTMLElement>) => {
    if (dragging.current) snapIndicator(event);
  };
  const endPick = () => {
    dragging.current = false;
  };
  const pickable = !!onIndicatorChange;
  const pickStyle = {
    pointerEvents: "auto",
    position: "relative",
    // A larger hit area than the drawn mark
    _before: { content: '""', position: "absolute", inset: "-6px" },
  } as const;

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
      <Slider.Control
        ref={controlRef}
        // Ignore presses on the bare track, so it doesn't jump the nearest
        // thumb to the pointer; the range only changes by dragging a thumb.
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement;
          if (
            !target.closest(
              "[data-part='thumb'], [data-tick-value], [data-testid='datetime-slider-indicator']"
            )
          )
            event.stopPropagation();
        }}
      >
        <Slider.Track>
          <Slider.Range />
        </Slider.Track>
        {((ticks && ticks.length > 0) || showIndicator) && (
          <Slider.MarkerGroup
            pointerEvents={"none"}
            // Above the thumbs (z-index 2), so a thumb's edge never covers the
            // marker or ticks beside the track
            zIndex={pickable ? 3 : undefined}
          >
            {ticks
              ?.filter((tick) => tick.value >= min && tick.value <= max)
              .map((tick, i) => (
                <Slider.Marker key={`${tick.value}-${i}`} value={tick.value}>
                  <Slider.MarkerIndicator
                    data-tick-value={tick.value}
                    data-in-range={tick.inRange !== false}
                    bg={tick.inRange === false ? "fg.subtle/50" : "fg"}
                    rounded={"none"}
                    // A rug beside the track, so the track stays readable
                    {...(vertical
                      ? { w: "2", h: "2px", ms: "-16px" }
                      : { h: "2", w: "2px", mt: "-16px" })}
                    {...(pickable &&
                      tick.inRange !== false && {
                        ...pickStyle,
                        onPointerDown: startPick,
                        onPointerMove: movePick,
                        onPointerUp: endPick,
                        onPointerCancel: endPick,
                        onLostPointerCapture: endPick,
                        cursor: "pointer",
                        title: "Select this item",
                      })}
                  />
                </Slider.Marker>
              ))}
            {showIndicator && (
              <Slider.Marker value={indicator}>
                <Slider.MarkerIndicator
                  data-testid={"datetime-slider-indicator"}
                  boxSize={"3"}
                  // In the tick lane beside the track, clear of the range thumbs
                  {...(vertical ? { ms: "-20px" } : { mt: "-20px" })}
                  bg={indicatorInRange ? "orange.solid" : "bg"}
                  borderWidth={"2px"}
                  borderColor={"orange.solid"}
                  shadow={"sm"}
                  {...(pickable && {
                    ...pickStyle,
                    // No enlarged hit area, which would reach over the thumbs
                    _before: undefined,
                    onPointerDown: startPick,
                    onPointerMove: movePick,
                    onPointerUp: endPick,
                    onPointerCancel: endPick,
                    onLostPointerCapture: endPick,
                    cursor: "grab",
                    _active: { cursor: "grabbing" },
                    title: "Drag to select an item in time",
                  })}
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
