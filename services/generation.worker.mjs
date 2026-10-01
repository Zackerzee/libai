/**
 * Generation Worker — 真实 Web Worker（Stage B3 §26）
 *
 * 这是「把 generateV2 移出主线程」的落点。它**不做任何算法**，
 * 只做三件事：收 request → 调 executeGenerationJob → 回 result。
 *
 * 三条纪律：
 *   1. **复用 B0 的契约**。这里吃的是 services/generation-request.mjs 的
 *      GenerationRequest，回的是 createGenerationResult / createGenerationError 的信封。
 *      没有 GenerationRequestV2，没有 WorkerRequest2，没有第二套协议（§25）。
 *   2. **不碰 DOM / window / 应用 state**。Worker 里没有它们，碰了就是 ReferenceError ——
 *      这反而是好事：它从结构上保证了「生成不依赖界面」。
 *   3. **进度用 postMessage 实时发**。Worker 在算的时候主线程是空闲的，
 *      所以主线程能收到并渲染这些进度 —— 这正是「不冻结 UI」的另一半。
 *
 * 图像数据用 Transferable 搬（§27）：调用方 postMessage 时把
 * `request.image.data.buffer` 放进 transfer 列表，零拷贝。
 *
 * 结果用紧凑契约回（§28）：palette + Int32Array 下标，避免 25 万个对象跨线程克隆。
 */

import { executeGenerationJob } from "./generation-job.mjs";
import { encodeGenerationResult } from "./generation-result-codec.mjs";

const post = (payload, transfer = []) => {
  try {
    self.postMessage(payload, transfer);
  } catch {
    // transfer 失败（buffer 已被 detach / 不支持 transfer）时退化为拷贝，
    // 绝不能因为「优化失败」把结果丢掉。
    self.postMessage(payload);
  }
};

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "generate") return;
  const request = message.request;
  const requestId = request?.requestId == null ? null : Number(request.requestId);

  try {
    const envelope = executeGenerationJob(request, {
      onPhase: (phase) => post({ type: "progress", requestId, phase }),
    });

    if (!envelope.ok) {
      // 引擎运行期故障：原样回错误信封，主线程据此报可读原因。
      post({ type: "result", requestId, envelope });
      return;
    }

    const compact = encodeGenerationResult(envelope);
    // indices 的 buffer 是这一版结果独有的，可以安全转移。
    const transfer = compact.indices?.buffer ? [compact.indices.buffer] : [];
    post({ type: "result", requestId, envelope: compact }, transfer);
  } catch (error) {
    // 走到这里说明是编程错误或 Worker 环境缺失（validate 抛、import 失败）。
    post({
      type: "error",
      requestId,
      name: String(error?.name || "Error"),
      message: String(error?.message || error || "生成失败"),
    });
  }
};
