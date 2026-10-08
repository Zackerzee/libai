/**
 * 外部图纸的图例识别：定位图例色块 → 逐块 OCR → 解析编号/数量 → 与本站色卡交叉校验。
 *
 * 流程与参考实现（perler-bead-manager 的 recognizer/index.ts）一致，但有两处
 * 刻意的增强，都是为了减少"人工逐个核对"的负担：
 *
 * 1. **颜色交叉校验**。OCR 会把 `A11` 读成 `A1l`、`G20` 读成 `620`，但色块的
 *    颜色是准确的。所以每一条同时给出"按采样色匹配到本站色卡的结果"，两者一致
 *    直接放行，不一致才标红要求人工确认 —— 比"只给 OCR 结果"可靠得多。
 * 2. **三档状态**（ok / review / failed）而不是"成功或失败"两档。人工校正表格
 *    只需要盯住 review 与 failed，几十条图例不用逐条看。
 *
 * 注意：站内生成的图纸不需要走这条路 —— 它的 `state.stats` 已经是精确的色号与
 * 颗数，直接扣料即可（见 inventory-service 的 previewFromPattern）。OCR 只服务
 * 于"别人给的 / 买来的"外部图纸。
 */

import { analyzeLegend, medianRgb } from "./pattern-legend-service.js";
import { parseLegendText } from "./legend-text-parse.js";
import { createCropSource } from "./ocr-service.js";

/** 低于此置信度进入人工复核；不丢弃，只是标出来。 */
export const MIN_CONFIDENCE = 45;
const CELL_INSET_RATIO = 0.2;
const CELL_INSET_MIN = 4;
const CELL_INSET_MAX = 12;
/** 单张图纸最多处理的图例格数，避免异常图片把浏览器拖死。 */
export const MAX_SWATCHES = 240;

/** 整块色块默认往内收的边距（避开边框与锯齿）。 */
export function cellInsetFor(box) {
  return Math.max(CELL_INSET_MIN, Math.min(CELL_INSET_MAX, Math.round((box.y1 - box.y0) * CELL_INSET_RATIO)));
}

/** 区域来源的读取优先级：印在色块内部的文字先读，再补紧致框与周边。 */
export function rankSource(source) {
  return source === "cell" ? 0 : source === "tight" ? 1 : 2;
}

/** 解析结果的完整度打分：字母+数字 > 纯字母 > 纯数字，带数量加分。 */
export function parseScore(parse) {
  if (!parse) return 0;
  let score = 0;
  if (parse.id) {
    if (/^[A-Z]+\d+$/.test(parse.id)) score += 60;
    else if (/^[A-Z]+$/.test(parse.id)) score += 40;
    else score += 20;
  }
  if (isCount(parse.count)) score += 30;
  return score;
}

function isCount(value) {
  return value !== null && value !== undefined && Number.isInteger(value) && value >= 0;
}

/**
 * 合并同一色块多个区域（整块 / 紧致 / 周边）的解析结果：
 * 取完整度最高的一条；若它缺数量，用其它区域里合法的数量补上。
 * 编号缺失时不用"纯数量"冒充编号 —— 宁可空着让人工填，也不要产出错误编号。
 */
export function mergeRegionReads(reads) {
  const valid = reads.filter((read) => read.parse);
  if (!valid.length) return null;
  let best = valid[0];
  let bestScore = -1;
  for (const read of valid) {
    const score = parseScore(read.parse) + (read.confidence || 0) / 1000;
    if (score > bestScore) { bestScore = score; best = read; }
  }
  let count = best.parse.count ?? null;
  if (!isCount(count)) {
    for (const read of valid) {
      if (isCount(read.parse.count)) { count = read.parse.count; break; }
    }
  }
  const id = best.parse.id || null;
  return { id, count: isCount(count) ? count : null, confidence: best.confidence || 0 };
}

const STATUS_LABELS = { ok: "已识别", review: "需核对", failed: "未识别" };

/**
 * 判定一条图例需要多少人工介入。
 * @param code OCR 编号（可能为空）
 * @param count OCR 数量（可能为 null）
 * @param confidence OCR 置信度
 * @param match  按采样色匹配到的本站色卡条目（可能为 null）
 */
export function classifyRow({ code, count, confidence, match, agreed }) {
  const warnings = [];
  if (!code) {
    warnings.push("OCR 未能读出编号，请手工补录");
    return { status: "failed", label: STATUS_LABELS.failed, warnings };
  }
  let status = "ok";
  if (!/^[A-Z]+\d+$/.test(code)) {
    warnings.push(`编号 ${code} 结构可疑（疑似 OCR 丢失字母或数字）`);
    status = "review";
  }
  if (isCount(count) === false) {
    warnings.push(`编号 ${code} 的数量无法识别`);
    status = "review";
  }
  if (confidence > 0 && confidence < MIN_CONFIDENCE) {
    warnings.push(`编号 ${code} 的 OCR 置信度偏低（${Math.round(confidence)}）`);
    status = "review";
  }
  if (match && agreed === false) {
    warnings.push(`编号 ${code} 与色块颜色最接近的 ${match.code} 不一致，请确认以哪个为准`);
    status = "review";
  }
  return { status, label: STATUS_LABELS[status], warnings };
}

/** RGBA 平铺数组转成三通道 RGB（检测与取色都按三通道算）。 */
export function rgbaToRgb(data, width, height) {
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0, k = 0; i < width * height; i += 1, j += 4, k += 3) {
    rgb[k] = data[j];
    rgb[k + 1] = data[j + 1];
    rgb[k + 2] = data[j + 2];
  }
  return rgb;
}

const hex = (rgb) => `#${rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

export function createLegendRecognitionService({ ocr, matchColor = null, createSource = createCropSource } = {}) {
  if (!ocr) throw new Error("缺少 OCR 服务");

  /** 读一个区域并解析。返回值直接进 mergeRegionReads。 */
  async function readRegion(source, region, { insetOverride = null } = {}) {
    const isCell = region.source === "cell";
    const result = await ocr.recognizeBox(source, region.box, {
      psm: isCell ? 6 : 7,
      ...(isCell ? { inset: insetOverride ?? cellInsetFor(region.box), binarize: false } : {}),
      ...(region.ink ? { polarity: region.ink } : {}),
    });
    return { region, text: result.text, confidence: result.confidence, parse: parseLegendText(result.text) };
  }

  /**
   * @param imageData 原图分辨率的 ImageData（检测会自行降采样，裁剪仍用原图高清像素）
   */
  async function recognize(imageData, { onProgress = () => {}, maxSwatches = MAX_SWATCHES } = {}) {
    const image = { width: imageData.width, height: imageData.height, rgb: rgbaToRgb(imageData.data, imageData.width, imageData.height) };
    const analysis = analyzeLegend(image);
    const swatches = analysis.swatches.slice(0, maxSwatches);
    const regions = analysis.regions.slice(0, maxSwatches);
    const source = createSource(imageData);
    const rows = [];
    const warnings = [];
    let truncated = false;
    if (analysis.swatches.length > maxSwatches) {
      truncated = true;
      warnings.push({ level: "warn", message: `图例格数超过 ${maxSwatches}，只处理了前 ${maxSwatches} 个` });
    }
    if (!swatches.length) warnings.push({ level: "error", message: "没有在这张图里找到图例色块" });

    const colInRow = new Map();
    for (let i = 0; i < swatches.length; i += 1) {
      const swatch = swatches[i];
      const row = swatch.row + 1;
      const col = (colInRow.get(swatch.row) || 0) + 1;
      colInRow.set(swatch.row, col);
      onProgress({ stage: "ocr", current: i + 1, total: swatches.length, message: `正在识别第 ${row} 行第 ${col} 个图例…` });

      const reads = [];
      for (const region of [...(regions[i] || [])].sort((a, b) => rankSource(a.source) - rankSource(b.source))) {
        try {
          reads.push(await readRegion(source, region));
        } catch (error) {
          warnings.push({ level: "error", message: `第 ${row} 行第 ${col} 个图例识别出错：${error.message}` });
          break;
        }
      }

      let merged = mergeRegionReads(reads);
      // 主结果没读出编号、或编号结构可疑时，多半是 inset 把印在色块边缘的前缀切掉了：
      // 用零/减半 inset 重读整块，再按完整度择优（G20(1076) 会比 620(1076) 得分高）。
      if (!merged || !merged.id || !/^[A-Z]+\d+$/.test(merged.id)) {
        const baseInset = cellInsetFor(swatch);
        for (const inset of [0, Math.max(1, Math.floor(baseInset / 2))]) {
          try {
            reads.push(await readRegion(source, { box: swatch, source: "cell" }, { insetOverride: inset }));
          } catch { /* 抢救失败不影响主结果 */ }
        }
        merged = mergeRegionReads(reads);
      }

      const rawText = reads.map((read) => read.text).filter(Boolean).join(" ").trim();
      const sampled = medianRgb(image.rgb, image.width, {
        x0: Math.min(swatch.x0 + 3, swatch.x1 - 1),
        y0: Math.min(swatch.y0 + 3, swatch.y1 - 1),
        x1: Math.max(swatch.x0 + 4, swatch.x1 - 3),
        y1: Math.max(swatch.y0 + 4, swatch.y1 - 3),
      });
      const rgb = [sampled.r, sampled.g, sampled.b];
      const matched = matchColor ? matchColor(rgb) : null;
      const match = matched?.nearest ? { code: matched.nearest, name: "", hex: "", distance: null, candidates: matched.candidates || [] } : null;
      const code = merged?.id || "";
      const count = merged?.count ?? null;
      const agreed = !match ? null : match.code === code;
      const verdict = classifyRow({ code, count, confidence: merged?.confidence || 0, match, agreed });

      rows.push({
        index: i,
        row, col,
        code,
        count,
        text: rawText || "空",
        confidence: merged?.confidence || 0,
        rgb,
        hex: hex(rgb),
        match,
        agreed,
        status: verdict.status,
        statusLabel: verdict.label,
        warnings: verdict.warnings,
      });
    }

    onProgress({ stage: "done", current: swatches.length, total: swatches.length, message: "识别完成" });
    return {
      image: { width: imageData.width, height: imageData.height, detectScale: analysis.scale, detectWidth: analysis.detectWidth, detectHeight: analysis.detectHeight },
      rows,
      warnings,
      truncated,
      counts: {
        total: rows.length,
        ok: rows.filter((row) => row.status === "ok").length,
        review: rows.filter((row) => row.status === "review").length,
        failed: rows.filter((row) => row.status === "failed").length,
      },
      totalBeads: rows.reduce((sum, row) => sum + (isCount(row.count) ? row.count : 0), 0),
    };
  }

  return { recognize };
}

/** 把人工校正后的行转成可扣料的明细（丢掉数量为 0 或编号为空的行）。 */
export function rowsToLines(rows = []) {
  return rows
    .map((row) => ({ code: String(row.code || "").trim().toUpperCase(), count: Math.round(Number(row.count) || 0), name: String(row.name || "") }))
    .filter((line) => line.code && line.count > 0);
}
