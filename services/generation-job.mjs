/**
 * Generation job — Worker-ready execution boundary
 *
 * 这是「生成」的**唯一执行入口**。当前它跑在主线程；把这一段原样放进 Web Worker
 * 就能变成异步执行，**调用方一行都不用改**，因为它：
 *
 *   · 只吃可序列化的 GenerationRequest
 *   · 只吐可序列化的 GenerationResult / GenerationError
 *   · 不碰 DOM、不碰 window、不碰任何应用 state
 *
 * 契约细节见 services/generation-request.mjs。
 * 纯计算，无 DOM —— node --test 里可以直接跑（tests/generation-request-contract.test.mjs 有守卫）。
 */

import { runGenerationPipeline } from "./generation-pipeline.mjs";
import {
  createGenerationError,
  createGenerationResult,
  validateGenerationRequest,
} from "./generation-request.mjs";

const now = () => (typeof performance !== "undefined" && typeof performance.now === "function"
  ? performance.now()
  : Date.now());

/**
 * 执行一次生成。
 *
 * 请求形状非法 → 抛（编程错误，应该在开发期暴露）。
 * 引擎运行期失败 → 返回 GenerationError 信封（可预期的运行时故障，不抛）。
 *
 * @param {object} request GenerationRequest
 * @returns {object} GenerationResult | GenerationError
 */
export function executeGenerationJob(request) {
  validateGenerationRequest(request);
  const startedAt = now();
  try {
    const pipeline = runGenerationPipeline({
      image: request.image,
      mode: request.mode,
      size: { width: request.size.width, height: request.size.height },
      palette: request.palette,
      maxColors: request.maxColors,
      overrides: request.overrides,
    });
    return createGenerationResult({
      requestId: request.requestId,
      grid: pipeline.grid,
      width: pipeline.width,
      height: pipeline.height,
      diagnostics: pipeline.diagnostics || null,
      pipeline: pipeline.pipeline || null,
      milliseconds: now() - startedAt,
    });
  } catch (error) {
    return createGenerationError({ requestId: request.requestId, error });
  }
}
