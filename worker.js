"use strict";

self.addEventListener("message", (event) => {
  try {
    const { pixelData, width, height, targetColor, threshold, paletteColors } = event.data || {};
    const pixels = getPixelData(pixelData, width, height);
    const paletteIndex = createPaletteIndex(paletteColors);
    const target = getTargetColor(targetColor, paletteIndex);
    const distanceThreshold = Math.max(0, Number(threshold) || 0);
    const analysis = analyzeConnectedBackground(pixels, width, height);

    denoisePixels(pixels, width, height, target, distanceThreshold, analysis.mask);

    self.postMessage(
      {
        pixelData: pixels,
        width,
        height,
        maskedRatio: analysis.maskedRatio,
        shouldRemove: analysis.shouldRemove,
      },
      [pixels.buffer],
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

function getPixelData(pixelData, width, height) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError("width and height must be positive integers");
  }

  let pixels;
  if (pixelData instanceof Uint8Array || pixelData instanceof Uint8ClampedArray) {
    pixels = pixelData;
  } else if (pixelData instanceof ArrayBuffer) {
    pixels = new Uint8Array(pixelData);
  } else {
    throw new TypeError("pixelData must be a Uint8Array");
  }

  const expectedLength = width * height * 4;
  if (pixels.byteLength !== expectedLength) {
    throw new RangeError(`pixelData must contain exactly ${expectedLength} RGBA values`);
  }

  if (pixels.byteOffset !== 0 || pixels.byteLength !== pixels.buffer.byteLength) {
    return new Uint8Array(pixels);
  }
  return pixels;
}

function createPaletteIndex(paletteColors) {
  if (!Array.isArray(paletteColors)) return new Uint8Array(0);

  const palette = new Uint8Array(paletteColors.length * 3);
  paletteColors.forEach((color, index) => {
    const rgb = color?.rgb;
    if (!Array.isArray(rgb) && !(rgb instanceof Uint8Array)) return;
    const offset = index * 3;
    palette[offset] = clampByte(rgb[0]);
    palette[offset + 1] = clampByte(rgb[1]);
    palette[offset + 2] = clampByte(rgb[2]);
  });
  return palette;
}

function getTargetColor(targetColor, paletteIndex) {
  if (targetColor instanceof Uint8Array || targetColor instanceof Uint8ClampedArray) {
    if (targetColor.length >= 3) {
      return [targetColor[0], targetColor[1], targetColor[2]];
    }
  }
  if (paletteIndex.length >= 3) {
    return [paletteIndex[0], paletteIndex[1], paletteIndex[2]];
  }
  throw new TypeError("targetColor must contain at least three RGB values");
}

function clampByte(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
}

function denoisePixels(pixels, width, height, targetColor, threshold, backgroundMask) {
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    if (backgroundMask?.[pixelIndex]) continue;
    const dataIndex = pixelIndex * 4;
    if (pixels[dataIndex + 3] < 24) continue;

    const distance = Math.hypot(
      pixels[dataIndex] - targetColor[0],
      pixels[dataIndex + 1] - targetColor[1],
      pixels[dataIndex + 2] - targetColor[2],
    );
    if (distance > threshold) continue;

    pixels[dataIndex] = targetColor[0];
    pixels[dataIndex + 1] = targetColor[1];
    pixels[dataIndex + 2] = targetColor[2];
  }
}

function analyzeConnectedBackground(pixels, width, height) {
  const cornerAnalysis = getCornerBackgroundAnalysis(pixels, width, height);
  const reference = cornerAnalysis.reference;
  const rawMask = reference ? createConnectedBackgroundMask(pixels, width, height, reference) : null;
  const protectionMask = reference ? createForegroundProtectionMask(pixels, width, height, reference) : null;
  const mask = reference
    ? createConnectedBackgroundMask(pixels, width, height, reference, protectionMask)
    : null;
  const maskedCount = mask ? countMask(mask) : 0;
  const rawMaskedCount = rawMask ? countMask(rawMask) : 0;
  const total = Math.max(1, width * height);
  const maskedRatio = maskedCount / total;
  const rawMaskedRatio = rawMaskedCount / total;
  const edgeStats = reference
    ? getEdgeBackgroundStats(pixels, width, height, reference)
    : { edgeMatchRatio: 0, cornerMatchRatio: 0 };
  const refBrightness = reference ? getBrightness(reference) : 0;
  const refChroma = reference ? getChroma(reference) : 255;
  const lightNeutralReference = refBrightness >= 188 && refChroma <= 64;
  const softPlainReference =
    refBrightness >= 174 &&
    refChroma <= 88 &&
    cornerAnalysis.matchingCorners >= 4 &&
    cornerAnalysis.cornerSpread <= 42 &&
    edgeStats.edgeMatchRatio >= 0.78 &&
    rawMaskedRatio <= 0.82;
  const removableReference = lightNeutralReference || softPlainReference;
  const shouldRemove =
    removableReference &&
    cornerAnalysis.matchingCorners >= 3 &&
    cornerAnalysis.cornerSpread <= 58 &&
    edgeStats.edgeMatchRatio >= 0.68 &&
    edgeStats.cornerMatchRatio >= 0.74 &&
    rawMaskedRatio >= 0.08 &&
    rawMaskedRatio <= 0.92 &&
    maskedRatio >= 0.02;

  return { mask, maskedRatio, shouldRemove };
}

function createConnectedBackgroundMask(
  pixels,
  width,
  height,
  reference = getCornerBackgroundColor(pixels, width, height),
  protectionMask = null,
) {
  const mask = new Uint8Array(width * height);
  const queue = [];
  const pushIfBackground = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (mask[pixelIndex] || protectionMask?.[pixelIndex]) return;
    if (!isBackgroundLikePixel(pixels, pixelIndex * 4, reference)) return;
    mask[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    pushIfBackground(x, 0);
    pushIfBackground(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    pushIfBackground(0, y);
    pushIfBackground(width - 1, y);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const pixelIndex = queue[head];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    pushIfBackground(x + 1, y);
    pushIfBackground(x - 1, y);
    pushIfBackground(x, y + 1);
    pushIfBackground(x, y - 1);
  }

  return mask;
}

function createForegroundProtectionMask(pixels, width, height, reference) {
  const anchors = new Uint8Array(width * height);
  let anchorCount = 0;
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    if (!isForegroundAnchorPixel(pixels, dataIndex, reference)) continue;
    anchors[pixelIndex] = 1;
    anchorCount += 1;
  }

  if (!anchorCount) return null;
  return dilateMask(anchors, width, height, getForegroundProtectionRadius(width, height));
}

function isForegroundAnchorPixel(pixels, index, reference) {
  if (pixels[index + 3] < 24) return false;
  return !isBackgroundLikePixel(pixels, index, reference);
}

function getForegroundProtectionRadius(width, height) {
  return Math.round(clamp(Math.min(width, height) * 0.035, 2, 8));
}

function dilateMask(mask, width, height, radius) {
  const output = new Uint8Array(mask.length);
  const offsets = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    if (!mask[pixelIndex]) continue;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    offsets.forEach(([dx, dy]) => {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return;
      output[nextY * width + nextX] = 1;
    });
  }

  return output;
}

function getCornerBackgroundAnalysis(pixels, width, height) {
  const cornerSize = getCornerSampleSize(width, height);
  const corners = [
    getCornerSample(pixels, width, height, 0, 0, cornerSize),
    getCornerSample(pixels, width, height, 1, 0, cornerSize),
    getCornerSample(pixels, width, height, 0, 1, cornerSize),
    getCornerSample(pixels, width, height, 1, 1, cornerSize),
  ].filter(Boolean);
  const lightCorners = corners.filter(
    (corner) => getBrightness(corner) >= 188 && getChroma(corner) <= 70,
  );
  const lightGroup = getBestMatchingColorGroup(lightCorners, 62);
  const allCornerGroup = getBestMatchingColorGroup(corners, 54);
  const bestGroup = lightGroup.length >= 3 ? lightGroup : allCornerGroup;
  const reference = bestGroup.length ? averageRgb(bestGroup) : null;
  const cornerSpread = reference
    ? Math.max(...bestGroup.map((corner) => rgbDistance(corner, reference)))
    : Infinity;

  return { reference, matchingCorners: bestGroup.length, cornerSpread };
}

function getCornerSample(pixels, width, height, right, bottom, size) {
  const samples = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sampleX = right ? width - 1 - x : x;
      const sampleY = bottom ? height - 1 - y : y;
      const index = (sampleY * width + sampleX) * 4;
      if (pixels[index + 3] < 24) continue;
      samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
    }
  }
  return samples.length ? averageRgb(samples) : null;
}

function getEdgeBackgroundStats(pixels, width, height, reference) {
  let edgeSamples = 0;
  let edgeMatches = 0;
  const testPixel = (x, y) => {
    const index = (y * width + x) * 4;
    edgeSamples += 1;
    if (isBackgroundLikePixel(pixels, index, reference)) edgeMatches += 1;
  };

  for (let x = 0; x < width; x += 1) {
    testPixel(x, 0);
    if (height > 1) testPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    testPixel(0, y);
    if (width > 1) testPixel(width - 1, y);
  }

  const cornerSize = getCornerSampleSize(width, height);
  let cornerSamples = 0;
  let cornerMatches = 0;
  const testCorner = (x, y) => {
    const index = (y * width + x) * 4;
    cornerSamples += 1;
    if (isBackgroundLikePixel(pixels, index, reference)) cornerMatches += 1;
  };

  for (let y = 0; y < cornerSize; y += 1) {
    for (let x = 0; x < cornerSize; x += 1) {
      testCorner(x, y);
      testCorner(width - 1 - x, y);
      testCorner(x, height - 1 - y);
      testCorner(width - 1 - x, height - 1 - y);
    }
  }

  return {
    edgeMatchRatio: edgeSamples ? edgeMatches / edgeSamples : 0,
    cornerMatchRatio: cornerSamples ? cornerMatches / cornerSamples : 0,
  };
}

function getCornerSampleSize(width, height) {
  return Math.max(2, Math.round(Math.min(width, height) * 0.08));
}

function countMask(mask) {
  if (!mask) return 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) count += 1;
  }
  return count;
}

function getBestMatchingColorGroup(colors, maxDistance) {
  let bestGroup = [];
  colors.forEach((color) => {
    const group = colors.filter((candidate) => rgbDistance(color, candidate) <= maxDistance);
    if (group.length > bestGroup.length) bestGroup = group;
  });
  return bestGroup;
}

function averageRgb(colors) {
  return colors
    .reduce((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
    .map((value) => value / colors.length);
}

function rgbDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function getBrightness(rgbValue) {
  return (rgbValue[0] + rgbValue[1] + rgbValue[2]) / 3;
}

function getChroma(rgbValue) {
  return Math.max(rgbValue[0], rgbValue[1], rgbValue[2]) - Math.min(...rgbValue);
}

function getCornerBackgroundColor(pixels, width, height) {
  const cornerSize = getCornerSampleSize(width, height);
  const samples = [];
  const addSample = (x, y) => {
    const index = (y * width + x) * 4;
    if (pixels[index + 3] < 24) return;
    samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
  };

  for (let y = 0; y < cornerSize; y += 1) {
    for (let x = 0; x < cornerSize; x += 1) {
      addSample(x, y);
      addSample(width - 1 - x, y);
      addSample(x, height - 1 - y);
      addSample(width - 1 - x, height - 1 - y);
    }
  }

  if (!samples.length) return [255, 255, 255];
  return averageRgb(samples);
}

function isBackgroundLikePixel(pixels, index, reference) {
  if (pixels[index + 3] < 24) return true;
  const red = pixels[index];
  const green = pixels[index + 1];
  const blue = pixels[index + 2];
  const brightness = (red + green + blue) / 3;
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  const refBrightness = (reference[0] + reference[1] + reference[2]) / 3;
  const distance = Math.hypot(red - reference[0], green - reference[1], blue - reference[2]);

  if (refBrightness > 190) {
    return brightness > 184 && chroma < 52 && distance < 96;
  }
  return distance < 54;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
