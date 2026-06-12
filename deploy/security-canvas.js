"use strict";

(() => {
  if (typeof CanvasRenderingContext2D === "undefined") return;

  const prototype = CanvasRenderingContext2D.prototype;
  const originalGetImageData = prototype.getImageData;
  if (typeof originalGetImageData !== "function") return;

  const ownOrigin = window.location.origin;
  const extensionPattern =
    /(?:chrome-extension|moz-extension|safari-extension|extension):\/\/|extensions::/i;
  const sourcePattern =
    /(?:https?|file|blob|data|chrome-extension|moz-extension|safari-extension|extension):[^\s)]+/gi;

  const isAuthorizedCall = (stack) => {
    if (extensionPattern.test(stack)) return false;

    const sources = stack.match(sourcePattern) || [];
    return sources.every((source) => {
      try {
        return new URL(source).origin === ownOrigin;
      } catch {
        return false;
      }
    });
  };

  const createEmptyImageData = (context, widthValue, heightValue, args) => {
    const width = Math.abs(Math.trunc(Number(widthValue)));
    const height = Math.abs(Math.trunc(Number(heightValue)));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
      return Reflect.apply(originalGetImageData, context, args);
    }
    return context.createImageData(width, height);
  };

  Object.defineProperty(prototype, "getImageData", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: function protectedGetImageData(sx, sy, sw, sh, ...options) {
      const stack = new Error().stack || "";
      if (!isAuthorizedCall(stack)) {
        console.warn(
          "[Canvas Security Alert] Blocked getImageData call from an unauthorized origin or browser extension.",
        );
        return createEmptyImageData(this, sw, sh, [sx, sy, sw, sh, ...options]);
      }
      return Reflect.apply(originalGetImageData, this, [sx, sy, sw, sh, ...options]);
    },
  });
})();
