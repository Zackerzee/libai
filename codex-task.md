# Task Instructions for Codex

You are working in the project at /Users/gongzhenyan/Documents/New project. This is a pixel bead pattern generator app (app.js + index.html).

## Task 1: Web Worker for Connected Component Denoising

### Understanding the Algorithm

The existing connected component denoising algorithm is in `app.js`. The core functions are:

- `analyzeConnectedBackground(pixels, width, height)` — analyzes corners, determines reference background color, creates mask
- `createConnectedBackgroundMask(pixels, width, height, reference, protectionMask)` — BFS flood-fill from edges through connected background-like pixels
- `createForegroundProtectionMask(pixels, width, height, reference)` — identifies foreground anchors and dilates protection zone
- `isBackgroundLikePixel(pixels, index, reference)` — determines if a pixel matches the background reference
- `getCornerBackgroundAnalysis(pixels, width, height)` — samples corners to find reference color
- `getCornerSample(pixels, width, height, right, bottom, size)` — samples one corner
- `getEdgeBackgroundStats(pixels, width, height, reference)` — edge matching stats
- `dilateMask(mask, width, height, radius)` — morphological dilation

### What to Create

Create a file `worker.js` in the project root that:
1. Implements the same connected component denoising algorithm as a Web Worker
2. Accepts messages with: `{ pixelData: Uint8Array, width: number, height: number, targetColor: Uint8Array, threshold: number, paletteColors: { hex: string, rgb: [number, number, number] }[] }`
3. Returns the denoised pixelData back via postMessage with Transferable Objects

### Key Details

- The web worker function: given an ImageData (pixelData as RGBA Uint8Array), a targetColor, and a threshold, perform connected component denoising:
  1. Get corner background analysis to find reference color
  2. Create background mask via flood-fill from edges
  3. For each pixel not in background mask, apply denoising: if pixel is within threshold of targetColor, snap it; otherwise leave it
  4. Return the processed pixelData

- Use BFS flood-fill (4-directional) from edge pixels
- The color comparison uses `isBackgroundLikePixel` logic:
  - alpha < 24 → transparent, skip
  - compute brightness, chroma, distance from reference
  - if reference brightness > 190: background if brightness > 184 && chroma < 52 && distance < 96
  - else: background if distance < 54

- **IMPORTANT**: Convert color palette to a Uint8Array index array (NOT a string array). The palette array should be flat: [r1, g1, b1, r2, g2, b2, ...]
- Use Transferable Objects: transfer the ArrayBuffer when sending to/from the worker

## Task 2: Security Hardening

### 2.1 Canvas Native Method Protection

Add a script to index.html (or a separate .js file) that:
- Uses `Object.defineProperty` to overwrite `CanvasRenderingContext2D.prototype.getImageData`
- The wrapper captures `new Error().stack` to get the call stack
- If the caller is from:
  - An illegal domain (not your own domain)
  - An unauthorized script (not from your own origin)
  - A browser extension (`extension://` or `chrome-extension://`)
- Then return empty ImageData (all transparent 0s) and `console.warn` with an alert

The original getImageData reference must be saved via a closure so legitimate calls still work.

### 2.2 Vercel Edge Middleware Rate Limiting

Create a file `middleware.js` (or `middleware.ts`) at the project root for Vercel Edge Functions:

- Target: `/api/convert` route
- Implement a token bucket rate limiter
- Two limits per IP:
  - 5 requests per minute (short window)
  - 50 requests per day (long window)
- If exceeded, return HTTP 429 with a JSON body: `{ "error": "Too Many Requests", "retryAfter": seconds }`
- Use a simple in-memory store (no external Redis dependency) since this is for Vercel Edge
- The middleware should extract IP from `x-forwarded-for` header or `request.headers.get` 

## Files to Create

1. `worker.js` — Web Worker for connected component denoising
2. `security-canvas.js` — Canvas getImageData protection script
3. `middleware.js` — Vercel Edge middleware for rate limiting
4. Update `index.html` to reference the new files

## Important Notes

- DO NOT modify app.js or index.html beyond adding script references
- The worker should work standalone, importScripts is fine
- For Transferable Objects: use `postMessage({...}, [buffer])` pattern
- All code must be plain JavaScript (ES modules or vanilla JS)
