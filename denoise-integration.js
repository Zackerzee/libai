"use strict";

/**
 * Main-thread glue code for Web Worker denoising.
 * - Listens to input events on #similarity-input (range slider)
 * - Throttles with requestAnimationFrame
 * - Sends pixelData to the worker via Transferable Objects
 * - Receives the result and renders it on an OffscreenCanvas
 */

(() => {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    console.warn("[Worker Denoiser] Web Worker or OffscreenCanvas not supported.");
    return;
  }

  const slider = document.querySelector("#similarity-input");
  if (!slider) {
    console.warn("[Worker Denoiser] #similarity-input not found.");
    return;
  }

  let worker = null;
  let pendingTransfer = null;
  let rafId = null;

  function getWorker() {
    if (worker) return worker;
    try {
      worker = new Worker("./worker.js");
      worker.onmessage = (event) => {
        const { pixelData, width, height, error } = event.data;
        if (error) {
          console.error("[Worker Denoiser] Error:", error);
          pendingTransfer = null;
          return;
        }
        // Render the result onto an OffscreenCanvas
        if (pendingTransfer && pendingTransfer.width === width && pendingTransfer.height === height) {
          const offscreen = pendingTransfer.offscreen;
          const ctx = offscreen.getContext("2d");
          if (ctx) {
            const imageData = new ImageData(
              new Uint8ClampedArray(pixelData.buffer || pixelData),
              width,
              height,
            );
            ctx.clearRect(0, 0, width, height);
            ctx.putImageData(imageData, 0, 0);
          }
        }
        pendingTransfer = null;
      };
      worker.onerror = (err) => {
        console.error("[Worker Denoiser] Worker error:", err.message);
        pendingTransfer = null;
      };
    } catch (e) {
      console.error("[Worker Denoiser] Failed to create worker:", e);
    }
    return worker;
  }

  function scheduleDenoise() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      performDenoise();
    });
  }

  function performDenoise() {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    // Get the current pixel data
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, width, height);
    } catch (e) {
      return;
    }

    const pixelData = new Uint8Array(imageData.data.buffer);
    const threshold = Number(slider.value) || 30;
    const targetColor = new Uint8Array([128, 128, 128]); // default neutral target

    const w = getWorker();
    if (!w) return;

    // Prepare OffscreenCanvas for receiving the result
    let offscreen;
    try {
      offscreen = new OffscreenCanvas(width, height);
    } catch (e) {
      offscreen = null;
    }

    pendingTransfer = { width, height, offscreen };

    // Convert palette colors to Uint8Array index array
    // The palette in app.js is accessed via getPaletteColors()
    const paletteColors = typeof getPaletteColors === "function" ? getPaletteColors() : [];

    // Transfer: send the pixelData buffer, keep pixelData as a view
    w.postMessage(
      {
        pixelData,
        width,
        height,
        targetColor,
        threshold,
        paletteColors,
      },
      [pixelData.buffer],
    );
  }

  const eventOpts = { passive: true };
  slider.addEventListener("input", scheduleDenoise, eventOpts);

  console.log("[Worker Denoiser] Initialized with rAF throttling.");
})();
