"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { CSSProperties, ForwardedRef } from "react";

export type PixelColor = string | null | undefined;

export interface PixelCanvasEngineProps {
  width: number;
  height: number;
  pixels: readonly PixelColor[];
  highlightColor: string | null;
  cellSize?: number;
  borderAlpha?: number;
  backgroundColor?: string;
  devicePixelRatio?: number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export interface PixelCanvasEngineHandle {
  /**
   * Slider fast path: only rebakes the highlight layer and recomposes the main
   * canvas. Use updateAllLayers when non-highlight pixels also changed.
   */
  updateHighlightLayer(
    nextPixels: readonly PixelColor[],
    nextHighlightColor?: string | null,
  ): void;
  updateBackgroundLayer(
    nextPixels: readonly PixelColor[],
    nextHighlightColor?: string | null,
  ): void;
  updateAllLayers(
    nextPixels: readonly PixelColor[],
    nextHighlightColor?: string | null,
  ): void;
  renderNow(): void;
  getMainCanvas(): HTMLCanvasElement | null;
}

interface RuntimeState {
  width: number;
  height: number;
  pixels: readonly PixelColor[];
  highlightColor: string | null;
  cellSize: number;
  borderAlpha: number;
  backgroundColor: string;
  dpr: number;
}

const DEFAULT_CELL_SIZE = 12;
const DEFAULT_BORDER_ALPHA = 0.55;
const MASK_COLOR = "rgba(0, 0, 0, 0.25)";
const MAX_DEVICE_PIXEL_RATIO = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError("PixelCanvasEngine: width must be a positive integer.");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError("PixelCanvasEngine: height must be a positive integer.");
  }
}

function validatePixels(
  pixels: readonly PixelColor[],
  width: number,
  height: number,
): void {
  if (pixels.length !== width * height) {
    throw new RangeError(
      `PixelCanvasEngine: pixels.length must equal width * height (${width * height}).`,
    );
  }
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("PixelCanvasEngine: CanvasRenderingContext2D is unavailable.");
  }
  return context;
}

function configureCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  dpr: number,
): CanvasRenderingContext2D {
  const physicalWidth = Math.max(1, Math.round(logicalWidth * dpr));
  const physicalHeight = Math.max(1, Math.round(logicalHeight * dpr));

  if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
  if (canvas.height !== physicalHeight) canvas.height = physicalHeight;

  const context = getCanvasContext(canvas);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  return context;
}

function PixelCanvasEngineInner(
  {
    width,
    height,
    pixels,
    highlightColor,
    cellSize = DEFAULT_CELL_SIZE,
    borderAlpha = DEFAULT_BORDER_ALPHA,
    backgroundColor = "transparent",
    devicePixelRatio,
    className,
    style,
    ariaLabel = "Pixel canvas",
  }: PixelCanvasEngineProps,
  forwardedRef: ForwardedRef<PixelCanvasEngineHandle>,
) {
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgBakingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hlBakingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const runtimeRef = useRef<RuntimeState>({
    width,
    height,
    pixels,
    highlightColor,
    cellSize,
    borderAlpha: clamp(borderAlpha, 0, 1),
    backgroundColor,
    dpr: 1,
  });

  const bakeBackgroundLayer = useCallback(() => {
    const canvas = bgBakingCanvasRef.current;
    if (!canvas) return;

    const runtime = runtimeRef.current;
    const { width: gridWidth, height: gridHeight, pixels: data } = runtime;
    const logicalWidth = gridWidth * runtime.cellSize;
    const logicalHeight = gridHeight * runtime.cellSize;
    const context = configureCanvas(canvas, logicalWidth, logicalHeight, runtime.dpr);

    context.clearRect(0, 0, logicalWidth, logicalHeight);
    if (runtime.backgroundColor !== "transparent") {
      context.fillStyle = runtime.backgroundColor;
      context.fillRect(0, 0, logicalWidth, logicalHeight);
    }

    /*
     * Merge horizontally adjacent pixels of the same color into one fillRect.
     * This reduces context state changes and draw calls for large flat regions.
     */
    for (let y = 0; y < gridHeight; y += 1) {
      const rowStart = y * gridWidth;
      let x = 0;

      while (x < gridWidth) {
        const color = data[rowStart + x];
        if (!color || color === runtime.highlightColor) {
          x += 1;
          continue;
        }

        let runEnd = x + 1;
        while (runEnd < gridWidth && data[rowStart + runEnd] === color) {
          runEnd += 1;
        }

        context.fillStyle = color;
        context.fillRect(
          x * runtime.cellSize,
          y * runtime.cellSize,
          (runEnd - x) * runtime.cellSize,
          runtime.cellSize,
        );
        x = runEnd;
      }
    }
  }, []);

  const bakeHighlightLayer = useCallback(() => {
    const canvas = hlBakingCanvasRef.current;
    if (!canvas) return;

    const runtime = runtimeRef.current;
    const { width: gridWidth, height: gridHeight, pixels: data } = runtime;
    const logicalWidth = gridWidth * runtime.cellSize;
    const logicalHeight = gridHeight * runtime.cellSize;
    const context = configureCanvas(canvas, logicalWidth, logicalHeight, runtime.dpr);

    context.clearRect(0, 0, logicalWidth, logicalHeight);
    if (!runtime.highlightColor) return;

    // Fill contiguous highlight runs first to minimize draw calls.
    context.fillStyle = runtime.highlightColor;
    for (let y = 0; y < gridHeight; y += 1) {
      const rowStart = y * gridWidth;
      let x = 0;

      while (x < gridWidth) {
        if (data[rowStart + x] !== runtime.highlightColor) {
          x += 1;
          continue;
        }

        let runEnd = x + 1;
        while (
          runEnd < gridWidth &&
          data[rowStart + runEnd] === runtime.highlightColor
        ) {
          runEnd += 1;
        }

        context.fillRect(
          x * runtime.cellSize,
          y * runtime.cellSize,
          (runEnd - x) * runtime.cellSize,
          runtime.cellSize,
        );
        x = runEnd;
      }
    }

    // Overlay a crisp, semi-transparent white border on every highlight pixel.
    const lineWidth = clamp(runtime.cellSize * 0.08, 1, 2);
    const inset = lineWidth / 2;
    const borderSize = Math.max(0, runtime.cellSize - lineWidth);
    context.lineWidth = lineWidth;
    context.strokeStyle = `rgba(255, 255, 255, ${runtime.borderAlpha})`;

    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== runtime.highlightColor) continue;
      const x = index % gridWidth;
      const y = (index - x) / gridWidth;
      context.strokeRect(
        x * runtime.cellSize + inset,
        y * runtime.cellSize + inset,
        borderSize,
        borderSize,
      );
    }
  }, []);

  const composeLayers = useCallback(() => {
    const mainCanvas = mainCanvasRef.current;
    const bgBakingCanvas = bgBakingCanvasRef.current;
    const hlBakingCanvas = hlBakingCanvasRef.current;
    if (!mainCanvas || !bgBakingCanvas || !hlBakingCanvas) return;

    const runtime = runtimeRef.current;
    const logicalWidth = runtime.width * runtime.cellSize;
    const logicalHeight = runtime.height * runtime.cellSize;
    const context = configureCanvas(
      mainCanvas,
      logicalWidth,
      logicalHeight,
      runtime.dpr,
    );

    context.clearRect(0, 0, logicalWidth, logicalHeight);
    context.drawImage(
      bgBakingCanvas,
      0,
      0,
      bgBakingCanvas.width,
      bgBakingCanvas.height,
      0,
      0,
      logicalWidth,
      logicalHeight,
    );
    context.fillStyle = MASK_COLOR;
    context.fillRect(0, 0, logicalWidth, logicalHeight);
    context.drawImage(
      hlBakingCanvas,
      0,
      0,
      hlBakingCanvas.width,
      hlBakingCanvas.height,
      0,
      0,
      logicalWidth,
      logicalHeight,
    );
  }, []);

  const cancelScheduledCompose = useCallback(() => {
    if (animationFrameRef.current === null) return;
    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const scheduleCompose = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      composeLayers();
    });
  }, [composeLayers]);

  const rebakeAll = useCallback(() => {
    bakeBackgroundLayer();
    bakeHighlightLayer();
    scheduleCompose();
  }, [bakeBackgroundLayer, bakeHighlightLayer, scheduleCompose]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      updateHighlightLayer(nextPixels, nextHighlightColor) {
        const runtime = runtimeRef.current;
        validatePixels(nextPixels, runtime.width, runtime.height);

        const colorChanged =
          nextHighlightColor !== undefined &&
          nextHighlightColor !== runtime.highlightColor;
        runtime.pixels = nextPixels;
        if (nextHighlightColor !== undefined) {
          runtime.highlightColor = nextHighlightColor;
        }

        /*
         * A changed highlight color changes background membership too, so the
         * background cache must be refreshed in that less-common case.
         */
        if (colorChanged) bakeBackgroundLayer();
        bakeHighlightLayer();
        scheduleCompose();
      },
      updateBackgroundLayer(nextPixels, nextHighlightColor) {
        const runtime = runtimeRef.current;
        validatePixels(nextPixels, runtime.width, runtime.height);
        runtime.pixels = nextPixels;
        if (nextHighlightColor !== undefined) {
          runtime.highlightColor = nextHighlightColor;
        }
        bakeBackgroundLayer();
        scheduleCompose();
      },
      updateAllLayers(nextPixels, nextHighlightColor) {
        const runtime = runtimeRef.current;
        validatePixels(nextPixels, runtime.width, runtime.height);
        runtime.pixels = nextPixels;
        if (nextHighlightColor !== undefined) {
          runtime.highlightColor = nextHighlightColor;
        }
        rebakeAll();
      },
      renderNow() {
        cancelScheduledCompose();
        composeLayers();
      },
      getMainCanvas() {
        return mainCanvasRef.current;
      },
    }),
    [
      bakeBackgroundLayer,
      bakeHighlightLayer,
      cancelScheduledCompose,
      composeLayers,
      rebakeAll,
      scheduleCompose,
    ],
  );

  useLayoutEffect(() => {
    validateDimensions(width, height);
    validatePixels(pixels, width, height);

    if (!bgBakingCanvasRef.current) {
      bgBakingCanvasRef.current = document.createElement("canvas");
    }
    if (!hlBakingCanvasRef.current) {
      hlBakingCanvasRef.current = document.createElement("canvas");
    }

    const resolvedDpr = clamp(
      devicePixelRatio ??
        (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1),
      1,
      MAX_DEVICE_PIXEL_RATIO,
    );
    runtimeRef.current = {
      width,
      height,
      pixels,
      highlightColor,
      cellSize: Math.max(1, cellSize),
      borderAlpha: clamp(borderAlpha, 0, 1),
      backgroundColor,
      dpr: resolvedDpr,
    };
    rebakeAll();
  }, [
    backgroundColor,
    borderAlpha,
    cellSize,
    devicePixelRatio,
    height,
    highlightColor,
    pixels,
    rebakeAll,
    width,
  ]);

  useEffect(
    () => () => {
      cancelScheduledCompose();
      bgBakingCanvasRef.current = null;
      hlBakingCanvasRef.current = null;
    },
    [cancelScheduledCompose],
  );

  const logicalWidth = width * Math.max(1, cellSize);
  const logicalHeight = height * Math.max(1, cellSize);

  return (
    <canvas
      ref={mainCanvasRef}
      aria-label={ariaLabel}
      className={className}
      role="img"
      style={{
        ...style,
        display: "block",
        width: logicalWidth,
        height: logicalHeight,
        imageRendering: "pixelated",
        transform: "translate3d(0, 0, 0)",
        willChange: "transform",
      }}
    />
  );
}

export const PixelCanvasEngine = forwardRef(PixelCanvasEngineInner);
PixelCanvasEngine.displayName = "PixelCanvasEngine";
