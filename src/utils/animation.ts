/**
 * Records an animation of the map: steps through stac-geoparquet items, waits
 * for each item's COG to finish loading in view, captures the map (basemap +
 * deck.gl layers) with a date label, and encodes the frames in the browser
 * with WebCodecs (via mediabunny).
 */
import { useStore, type State } from "@/store";
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";
import { getColormapLut } from "./colormap";
import { logScaleRange, type BandRange, type RasterStyle } from "./single-band";
import type { TimelineEntry } from "./stac-geoparquet";

/** Longest side of the video, in pixels. */
export const MAX_VIDEO_SIZE = 1920;

/** How long to wait for a frame's tiles before capturing it anyway. */
const FRAME_TIMEOUT_MS = 30_000;

export interface AnimationProgress {
  /** Frames captured so far. */
  done: number;
  total: number;
  /** Frames captured before their tiles finished loading. */
  timedOut: number;
}

export interface AnimationOptions {
  frames: TimelineEntry[];
  /** The map's container element; every canvas inside it is captured. */
  container: HTMLElement;
  /** The canvas frames are drawn to (also usable as a live preview). */
  canvas: HTMLCanvasElement;
  fps: number;
  /**
   * Text after the date in the label. Defaults to the key of the asset shown
   * on the map once the first frame has loaded.
   */
  label?: string;
  /** Draw the date (top left) and asset (top right) on each frame. */
  labels?: boolean;
  /**
   * Draw a scale bar (bottom left) using this many metres per CSS pixel at
   * the map's centre. Omit for no scale bar.
   */
  metersPerCssPixel?: number;
  /** Draw a colour bar (bottom right) for single-band rasters. */
  colorBar?: boolean;
  /** Keep the colour range of the first frame for every frame. */
  lockRange?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: AnimationProgress) => void;
}

/** Output size for a map of `width` × `height` CSS px: even, capped, at device resolution. */
export function getVideoSize(
  width: number,
  height: number,
  pixelRatio = 1
): { width: number; height: number } {
  const scale = Math.min(
    pixelRatio,
    MAX_VIDEO_SIZE / Math.max(width, height, 1)
  );
  const even = (v: number) => Math.max(2, Math.floor((v * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Draws every visible canvas in `container` onto `ctx`, scaled to fill it. */
export function compositeCanvases(
  container: HTMLElement,
  ctx: CanvasRenderingContext2D
) {
  const bounds = container.getBoundingClientRect();
  const scaleX = ctx.canvas.width / bounds.width;
  const scaleY = ctx.canvas.height / bounds.height;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const canvas of container.querySelectorAll("canvas")) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    ctx.drawImage(
      canvas,
      (rect.left - bounds.left) * scaleX,
      (rect.top - bounds.top) * scaleY,
      rect.width * scaleX,
      rect.height * scaleY
    );
  }
}

const LABEL_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Draws `text` in a box at the top left or top right. The box is sized to
 * `template` (or the text, if longer) so it keeps the same size every frame.
 */
function drawCornerLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  corner: "left" | "right",
  template = text
) {
  const { size, pad, margin } = overlayMetrics(ctx);
  ctx.font = `600 ${size}px ${LABEL_FONT}`;
  ctx.textBaseline = "top";
  const width = Math.max(
    ctx.measureText(template).width,
    ctx.measureText(text).width
  );
  const boxWidth = width + pad * 2;
  const boxX =
    corner === "left" ? margin : ctx.canvas.width - margin - boxWidth;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(boxX, margin, boxWidth, size + pad * 2);
  ctx.fillStyle = "white";
  ctx.textAlign = "left";
  ctx.fillText(text, boxX + pad, margin + pad);
}

/** Font size and padding for overlays, scaled to the frame. */
function overlayMetrics(ctx: CanvasRenderingContext2D) {
  const size = Math.max(12, Math.round(ctx.canvas.height * 0.03));
  const pad = Math.round(size * 0.5);
  return { size, pad, margin: pad * 2 };
}

/** A round length (1, 2 or 5 × 10ⁿ m) no longer than `maxMeters`. */
export function niceScaleLength(maxMeters: number): number {
  if (!(maxMeters > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  const step = [5, 2, 1].find((s) => s * power <= maxMeters) ?? 1;
  return step * power;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

/**
 * Draws a scale bar at the bottom left, at most a fifth of the frame wide.
 * `metersPerPixel` is in frame pixels, measured at the map's centre.
 */
export function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  metersPerPixel: number
) {
  const { size, pad, margin } = overlayMetrics(ctx);
  const meters = niceScaleLength((ctx.canvas.width / 5) * metersPerPixel);
  if (!meters) return;
  const barWidth = meters / metersPerPixel;
  const barHeight = Math.max(3, Math.round(size * 0.3));
  const text = formatDistance(meters);
  ctx.font = `600 ${size}px ${LABEL_FONT}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const boxWidth = Math.max(barWidth, ctx.measureText(text).width) + pad * 2;
  const boxHeight = size + pad * 3 + barHeight;
  const x = margin;
  const y = ctx.canvas.height - margin - boxHeight;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "white";
  ctx.fillText(text, x + pad, y + pad);
  ctx.fillRect(x + pad, y + pad * 2 + size, barWidth, barHeight);
}

/** A labelled value on the colour bar; `position` runs 0 (min) to 1 (max). */
export interface ColorBarTick {
  value: number;
  position: number;
  label: string;
}

/** Most labels the colour bar shows. */
const MAX_TICKS = 4;

/** Removes float noise, e.g. 0.30000000000000004 → 0.3. */
function clean(v: number): number {
  return Number(v.toPrecision(12));
}

/**
 * Round-number ticks inside `range`, like a plot axis: steps of 1, 2 or 5 ×
 * 10ⁿ on a linear scale, whole powers of ten on a log scale (`range` must then
 * be positive). Between 2 and {@link MAX_TICKS} ticks; when fewer than 2 round
 * values fit, the min and max to 2 significant digits.
 */
export function colorBarTicks(range: BandRange, log: boolean): ColorBarTick[] {
  const ticks = log ? logTicks(range) : linearTicks(range);
  if (ticks.length >= 2) return ticks;
  const two = (v: number) => Number(v.toPrecision(2)).toString();
  return [
    { value: range.min, position: 0, label: two(range.min) },
    { value: range.max, position: 1, label: two(range.max) },
  ];
}

function linearTicks({ min, max }: BandRange): ColorBarTick[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  // The smallest 1/2/5 × 10ⁿ step that gives at most MAX_TICKS ticks.
  const magnitude = 10 ** Math.floor(Math.log10(span / MAX_TICKS));
  for (const k of [1, 10, 100]) {
    for (const m of [1, 2, 5]) {
      const step = clean(m * k * magnitude);
      const first = Math.ceil(clean(min / step));
      const last = Math.floor(clean(max / step));
      if (last - first + 1 > MAX_TICKS) continue;
      const decimals = Math.max(0, -Math.floor(Math.log10(step)));
      const ticks: ColorBarTick[] = [];
      for (let i = first; i <= last; i++) {
        const value = clean(i * step);
        ticks.push({
          value,
          position: (value - min) / span,
          label: value === 0 ? "0" : value.toFixed(decimals),
        });
      }
      return ticks;
    }
  }
  return [];
}

function logTicks({ min, max }: BandRange): ColorBarTick[] {
  if (!(min > 0) || !(max > min)) return [];
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  const first = Math.ceil(clean(lo));
  const last = Math.floor(clean(hi));
  // Every decade, or every 2nd, 3rd, … when there are too many.
  const every = Math.ceil((last - first + 1) / MAX_TICKS);
  const ticks: ColorBarTick[] = [];
  for (let e = first; e <= last; e += every) {
    ticks.push({
      value: 10 ** e,
      position: (e - lo) / (hi - lo),
      label: formatPowerOfTen(e),
    });
  }
  return ticks;
}

/** 10ᵉ as "0.01", "1", "1k", "1M", or "1e-5" / "1e9" beyond those. */
export function formatPowerOfTen(e: number): string {
  if (e >= -3 && e <= 2) return clean(10 ** e).toString();
  if (e >= 3 && e <= 5) return `${10 ** (e - 3)}k`;
  if (e >= 6 && e <= 8) return `${10 ** (e - 6)}M`;
  return `1e${e}`;
}

/**
 * Draws a colour bar at the bottom right for a single-band raster, labelled
 * with round values (see {@link colorBarTicks}) and the `unit` after the last.
 */
export function drawColorBar(
  ctx: CanvasRenderingContext2D,
  range: BandRange,
  style: RasterStyle,
  unit?: string
) {
  const log = style.scale === "log" ? logScaleRange(range) : undefined;
  const ticks = colorBarTicks(log ?? range, !!log);

  // 256 colours, from the colormap or black to white.
  const lut = style.colormap ? getColormapLut(style.colormap) : undefined;
  const strip = new ImageData(256, 1);
  for (let i = 0; i < 256; i++) {
    const j = style.reversed ? 255 - i : i;
    strip.data[i * 4] = lut ? lut[j * 3] : j;
    strip.data[i * 4 + 1] = lut ? lut[j * 3 + 1] : j;
    strip.data[i * 4 + 2] = lut ? lut[j * 3 + 2] : j;
    strip.data[i * 4 + 3] = 255;
  }
  const stripCanvas = new OffscreenCanvas(256, 1);
  stripCanvas.getContext("2d")!.putImageData(strip, 0, 0);

  const { size, pad, margin } = overlayMetrics(ctx);
  ctx.font = `600 ${size}px ${LABEL_FONT}`;
  // The unit trails the last label; each number stays centred on its tick.
  const texts = ticks.map((tick, i) =>
    unit && i === ticks.length - 1 ? `${tick.label} ${unit}` : tick.label
  );
  const widths = texts.map((text) => ctx.measureText(text).width);
  const anchors = ticks.map((tick) => ctx.measureText(tick.label).width / 2);
  const textWidth = widths.reduce((sum, w) => sum + w + pad * 2, 0);
  const barWidth = Math.min(
    ctx.canvas.width / 2,
    Math.max(ctx.canvas.width / 4, textWidth)
  );
  const barHeight = Math.max(6, Math.round(size * 0.6));
  const markHeight = Math.max(2, Math.round(pad * 0.6));
  const boxWidth = barWidth + pad * 2;
  const boxHeight = barHeight + markHeight + size + pad * 3;
  const x = ctx.canvas.width - margin - boxWidth;
  const y = ctx.canvas.height - margin - boxHeight;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(stripCanvas, x + pad, y + pad, barWidth, barHeight);

  // Labels centred on their ticks but kept inside the bar; one that would
  // overlap the previous label is dropped (the previous one, for the last).
  const left = x + pad;
  type Placed = {
    tick: ColorBarTick;
    text: string;
    tickX: number;
    textX: number;
    width: number;
  };
  const shown: Placed[] = [];
  ticks.forEach((tick, i) => {
    const tickX = left + tick.position * barWidth;
    const textX = Math.min(
      Math.max(tickX - anchors[i], left),
      left + barWidth - widths[i]
    );
    const entry: Placed = {
      tick,
      text: texts[i],
      tickX,
      textX,
      width: widths[i],
    };
    const prev = shown.at(-1);
    if (prev && prev.textX + prev.width + pad > textX) {
      if (i !== ticks.length - 1) return;
      shown.pop();
    }
    shown.push(entry);
  });
  ctx.fillStyle = "white";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const markY = y + pad + barHeight;
  for (const { tick, text, tickX, textX } of shown) {
    const markX = Math.min(Math.max(tickX, left), left + barWidth - 1);
    if (tick.position > 0 && tick.position < 1) {
      ctx.fillRect(Math.round(markX - 0.5), markY, 1, markHeight);
    }
    ctx.fillText(text, textX, markY + markHeight + pad);
  }
}

/** The frame's date at the top left and, if given, the asset at the top right. */
export function drawLabels(
  ctx: CanvasRenderingContext2D,
  { date, asset }: { date: string; asset?: string }
) {
  drawCornerLabel(ctx, date, "left", "0000-00-00");
  if (asset) drawCornerLabel(ctx, asset, "right");
}

/** Resolves once `predicate` holds for the store, or after `timeout` ms (false). */
function waitForStore(
  predicate: (state: State) => boolean,
  timeout: number,
  signal?: AbortSignal
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (predicate(useStore.getState())) return resolve(true);
    const done = (value: boolean) => {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      clearTimeout(timer);
      unsubscribe();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => done(false), timeout);
    const unsubscribe = useStore.subscribe((state) => {
      if (predicate(state)) done(true);
    });
    signal?.addEventListener("abort", onAbort);
  });
}

/** Waits for the browser to paint `count` more frames. */
function nextPaint(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (n: number) =>
      n <= 0 ? resolve() : requestAnimationFrame(() => step(n - 1));
    step(count);
  });
}

/**
 * Selects `id` and waits until the visualization shows its COG with every
 * tile in view loaded. Returns false if that took longer than the timeout.
 */
async function showFrame(id: string, signal?: AbortSignal): Promise<boolean> {
  const before = useStore.getState();
  const changing = before.stacGeoparquetId !== id;
  const previousHref = before.visualizationStatus.href;
  if (changing) before.stepStacGeoparquetId(id);
  const loaded = await waitForStore(
    (state) => {
      const { href, loadedHref } = state.visualizationStatus;
      return (
        state.stacGeoparquetId === id &&
        !!href &&
        // While the next item loads, the panel still shows the previous one.
        (!changing || href !== previousHref) &&
        loadedHref === href
      );
    },
    FRAME_TIMEOUT_MS,
    signal
  );
  // onViewportLoad fires when the data arrives; give deck.gl time to draw it.
  await nextPaint(3);
  return loaded;
}

/** Records the animation and returns it as an MP4 (or WebM) blob. */
export async function recordAnimation({
  frames,
  container,
  canvas,
  fps,
  label,
  labels = true,
  metersPerCssPixel,
  colorBar = false,
  lockRange = true,
  signal,
  onProgress,
}: AnimationOptions): Promise<Blob> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't create a 2D canvas context.");
  if (frames.length === 0) throw new Error("No items to animate.");

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const codec = await getFirstEncodableVideoCodec(
    output.format.getSupportedVideoCodecs(),
    { width: canvas.width, height: canvas.height }
  );
  if (!codec) throw new Error("This browser can't encode video (WebCodecs).");
  const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const store = useStore.getState();
  const originalId = store.stacGeoparquetId;
  const originalRange = store.rasterRange;
  const progress: AnimationProgress = {
    done: 0,
    total: frames.length,
    timedOut: 0,
  };
  let labelText = label;
  try {
    for (const [i, frame] of frames.entries()) {
      signal?.throwIfAborted();
      const loaded = await showFrame(frame.id, signal);
      if (!loaded) progress.timedOut++;
      if (i === 0 && labelText === undefined) {
        const visualization = useStore.getState().visualization;
        labelText = visualization?.startsWith("asset:")
          ? visualization.slice("asset:".length)
          : undefined;
      }
      // Pin the first frame's range so colours mean the same thing throughout.
      if (i === 0 && lockRange && !originalRange) {
        const { range } = useStore.getState().visualizationStatus;
        if (range) useStore.getState().setRasterRange(range);
        await nextPaint(3);
      }
      compositeCanvases(container, ctx);
      const date = new Date(frame.datetime).toISOString().slice(0, 10);
      if (labels) drawLabels(ctx, { date, asset: labelText });
      if (metersPerCssPixel) {
        const cssWidth = container.getBoundingClientRect().width;
        drawScaleBar(ctx, (metersPerCssPixel * cssWidth) / canvas.width);
      }
      if (colorBar) {
        const state = useStore.getState();
        const range = state.rasterRange ?? state.visualizationStatus.range;
        if (range) {
          const unit = state.visualizationStatus.unit ?? undefined;
          drawColorBar(ctx, range, state.rasterStyle, unit);
        }
      }
      await source.add(i / fps, 1 / fps);
      progress.done = i + 1;
      onProgress?.({ ...progress });
    }
    await output.finalize();
  } catch (error) {
    await output.cancel();
    throw error;
  } finally {
    const state = useStore.getState();
    state.setRasterRange(originalRange);
    if (state.stacGeoparquetId !== originalId) {
      if (originalId) state.stepStacGeoparquetId(originalId);
      else state.setStacGeoparquetId(null);
    }
  }
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("The video encoder produced no data.");
  return new Blob([buffer], { type: await output.getMimeType() });
}
