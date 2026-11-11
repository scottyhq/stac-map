import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import DatetimeSlider from "../../src/components/ui/datetime-slider";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Rendered into a real browser, so picking snaps against the drawn ticks.
let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function renderSlider() {
  const container = document.createElement("div");
  container.style.width = "400px";
  container.style.padding = "40px";
  document.body.appendChild(container);
  const onIndicatorChange = vi.fn();
  const onChangeEnd = vi.fn();
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ChakraProvider value={defaultSystem}>
        <DatetimeSlider
          startBoundMs={0}
          endBoundMs={100}
          value={[0, 80]}
          onChangeEnd={onChangeEnd}
          ticks={[
            { value: 10 },
            { value: 50 },
            { value: 70 },
            { value: 90, inRange: false },
          ]}
          indicator={10}
          onIndicatorChange={onIndicatorChange}
        />
      </ChakraProvider>
    )
  );
  cleanup = () => {
    root.unmount();
    container.remove();
  };
  const center = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const tick = (value: number) =>
    container.querySelector(`[data-tick-value='${value}']`)!;
  const fire = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
        isPrimary: true,
        pointerType: "mouse",
      })
    );
  return { container, onIndicatorChange, onChangeEnd, center, tick, fire };
}

test("dragging the indicator snaps to the nearest in-range tick", async () => {
  const { container, onIndicatorChange, onChangeEnd, center, tick, fire } =
    await renderSlider();
  const indicator = container.querySelector(
    "[data-testid='datetime-slider-indicator']"
  )!;
  const { x, y } = center(indicator);

  await act(async () => {
    fire(indicator, "pointerdown", x, y);
    fire(indicator, "pointermove", center(tick(50)).x + 3, y);
    fire(indicator, "pointermove", center(tick(50)).x - 2, y); // no repeat
    fire(indicator, "pointermove", center(tick(70)).x - 4, y);
    fire(indicator, "pointermove", center(tick(90)).x, y); // out of range
    fire(indicator, "pointerup", center(tick(90)).x, y);
  });

  expect(onIndicatorChange.mock.calls).toEqual([[50], [70]]);
  expect(onChangeEnd).not.toHaveBeenCalled();
});

test("clicking an in-range tick selects it", async () => {
  const { onIndicatorChange, onChangeEnd, tick } = await renderSlider();
  await userEvent.click(tick(70) as HTMLElement);
  expect(onIndicatorChange.mock.calls).toEqual([[70]]);
  expect(onChangeEnd).not.toHaveBeenCalled();
});

test("dimmed ticks aren't clickable", async () => {
  const { tick } = await renderSlider();
  expect(getComputedStyle(tick(90)).pointerEvents).toBe("none");
  expect(getComputedStyle(tick(70)).pointerEvents).toBe("auto");
});

// Zag's slider ignores synthetic pointer events, so these use the real mouse.
test("pressing the bare track doesn't move a thumb", async () => {
  const { container, onChangeEnd } = await renderSlider();
  const track = container.querySelector<HTMLElement>("[data-part='track']")!;
  const rect = track.getBoundingClientRect();
  await userEvent.click(track, {
    position: { x: rect.width * 0.4, y: rect.height / 2 },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onChangeEnd).not.toHaveBeenCalled();
});

test("thumbs still drag", async () => {
  const { container, onChangeEnd, tick } = await renderSlider();
  const thumbs = container.querySelectorAll<HTMLElement>("[data-part='thumb']");
  expect(thumbs).toHaveLength(2);
  await userEvent.dragAndDrop(thumbs[1], tick(50));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onChangeEnd).toHaveBeenCalled();
  const [start, end] = onChangeEnd.mock.calls.at(-1)![0];
  expect(start).toBe(0);
  expect(end).toBeLessThan(80);
});
