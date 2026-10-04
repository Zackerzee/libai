/**
 * Generation Worker client — 主线程侧（Stage B3 §26 / §29 / §33）
 *
 * 职责边界（§26）：主线程**只负责**
 *   · 组装 request
 *   · postMessage
 *   · progress 回调
 *   · cancellation
 *   · result commit
 * 一行算法都不跑。
 *
 * 取消（§29）走**真 terminate**，不是「标记一下等它跑完」：
 * 一次 500×375 的生成在主线程要跑几分钟，而 Worker 里同样要跑几分钟 ——
 * 只是不再卡界面。用户点了取消就该真的停，所以这里直接杀 Worker，
 * 下次 run() 再懒起一个新的。
 *
 * 陈旧结果（§33）：客户端自己记「最新一次 run 的 requestId」，
 * 旧 requestId 的回包一律丢弃并 reject。这是**第二道**守卫 ——
 * app.js 的 isStaleGenerationRequest 是第一道，两道都留，
 * 因为「旧结果覆盖新图纸」是这一阶段最不能出的错。
 *
 * 纯逻辑、可注入 WorkerCtor —— node --test 里用假 Worker 直接验证取消与陈旧语义。
 */

import { decodeGenerationResult, isEncodedGenerationResult } from "./generation-result-codec.mjs";

/** 取消导致的失败。调用方据此区分「失败」与「用户主动取消」。 */
export class GenerationCancelledError extends Error {
  constructor(message = "生成已取消") {
    super(message);
    this.name = "AbortError";
  }
}

/** 回包属于已被取代的请求。 */
export class GenerationStaleError extends Error {
  constructor(message = "已丢弃过期结果") {
    super(message);
    this.name = "StaleGenerationError";
  }
}

export const DEFAULT_GENERATION_WORKER_URL = "./services/generation.worker.mjs?v=20261002-stage-b3";

/**
 * @param {object} [options]
 * @param {string} [options.workerUrl]
 * @param {Function} [options.WorkerCtor] 注入用；默认取全局 Worker
 * @returns {object} 客户端
 */
export function createGenerationWorkerClient({
  workerUrl = DEFAULT_GENERATION_WORKER_URL,
  WorkerCtor = typeof Worker !== "undefined" ? Worker : null,
} = {}) {
  let worker = null;
  let pending = null;           // { requestId, resolve, reject, onProgress }
  let latestRequestId = null;   // 最新一次 run 的 requestId —— 陈旧判定基准
  let unsupported = !WorkerCtor;
  /**
   * 是否已经成功跑完过至少一次。
   *
   * 为什么需要它：Transferable 是**不可逆**的 —— 转移 `request.image.data.buffer`
   * 之后主线程这一份就被 detach 了。如果 Worker 因为 CSP / 路径 / 模块错误起不来，
   * 调用方想退回主线程重跑，手里已经是一份空 buffer（表现为「data 长度不匹配」这种
   * 完全看不出根因的报错）。
   *
   * 所以第一次只做结构化克隆（拷贝一次，几 MB 量级，可接受），
   * **证明 Worker 真能跑通之后**，后续才启用零拷贝转移。
   * 代价是首次生成多一次拷贝；换来的是「Worker 坏了就自动退回主线程」而不是当场炸掉。
   */
  let warm = false;

  const detach = () => {
    if (!worker) return;
    try { worker.terminate(); } catch { /* 已死 */ }
    worker = null;
  };

  const settle = (kind, payload) => {
    const current = pending;
    pending = null;
    if (!current) return;
    if (kind === "resolve") current.resolve(payload);
    else current.reject(payload);
  };

  const ensureWorker = () => {
    if (worker) return worker;
    if (!WorkerCtor) throw new Error("当前环境不支持 Web Worker");
    // type: "module" —— 本项目的生成链路全是 ESM，worker 也必须按模块加载。
    worker = new WorkerCtor(workerUrl, { type: "module" });
    worker.onmessage = (event) => {
      const message = event.data || {};
      const requestId = message.requestId == null ? null : Number(message.requestId);

      if (message.type === "progress") {
        // 进度只喂给「当前正在等的那一个」。过期的进度直接丢。
        if (pending && pending.requestId === requestId) pending.onProgress?.(message.phase);
        return;
      }

      // 陈旧结果：绝不覆盖新图纸（§33）。
      if (pending && requestId != null && pending.requestId !== requestId) return;
      if (!pending && requestId != null && latestRequestId != null && requestId !== latestRequestId) return;

      if (message.type === "error") {
        settle("reject", new Error(message.message || "Worker 生成失败"));
        return;
      }

      if (message.type === "result") {
        const envelope = message.envelope;
        if (!envelope || envelope.ok !== true) {
          settle("reject", new Error(envelope?.message || "生成失败"));
          return;
        }
        if (!isEncodedGenerationResult(envelope)) {
          settle("reject", new Error("Worker 回包不符合紧凑结果契约"));
          return;
        }
        // §12 提交路径 profile：decode 是「Worker 算完了」到「主线程拿到 grid」
        // 之间的那段。500×375 是 18.75 万格，`decodeGenerationResult` 要按行
        // 建出同样数量的对象 —— 它长在**提交**上，不长在计算上。
        // 单独计时是为了让「Worker 没起作用」这个误判没有立足点。
        const tDecode = typeof performance !== "undefined" ? performance.now() : 0;
        const decoded = decodeGenerationResult(envelope);
        const decodeMs = typeof performance !== "undefined"
          ? Number((performance.now() - tDecode).toFixed(2))
          : null;
        warm = true;
        settle("resolve", {
          grid: decoded.grid,
          width: decoded.width,
          height: decoded.height,
          diagnostics: decoded.diagnostics,
          pipeline: decoded.pipeline,
          requestId: decoded.requestId,
          nullCount: decoded.nullCount,
          decodeMs,
        });
        return;
      }
    };
    worker.onerror = (event) => {
      const message = String(event?.message || "Worker 启动失败");
      detach();
      unsupported = true;
      settle("reject", new Error(message));
    };
    return worker;
  };

  return {
    get supported() { return !unsupported; },
    get busy() { return Boolean(pending); },
    get latestRequestId() { return latestRequestId; },

    /**
     * 跑一次生成。
     *
     * @param {object} request GenerationRequest（纯数据）
     * @param {{onProgress?:Function, transfer?:ArrayBuffer[]}} [options]
     *   transfer：默认转移 `request.image.data.buffer`（§27 零拷贝）。
     *   传 `transfer: []` 可关闭转移（数据要复用时）。
     */
    run(request, { onProgress = null, transfer = undefined } = {}) {
      return new Promise((resolve, reject) => {
        // 同一条链路上同时只允许一个在跑：新的直接顶掉旧的。
        //
        // 必须**杀掉 Worker** 而不是只 reject 旧 Promise：Worker 的 onmessage
        // 是同步执行的，旧任务没跑完就 postMessage 新请求，新请求只会排在旧任务
        // 后面等 —— 表现成「换了尺寸反而更慢」。terminate() 是唯一能真停下来的手段。
        if (pending) {
          const superseded = pending;
          pending = null;
          detach();
          superseded.reject(new GenerationStaleError("已被更新的生成请求取代"));
        }

        let target;
        try {
          target = ensureWorker();
        } catch (error) {
          reject(error);
          return;
        }

        const requestId = Number(request?.requestId);
        latestRequestId = requestId;
        pending = { requestId, resolve, reject, onProgress };

        const buffers = transfer === undefined
          ? (warm && request?.image?.data?.buffer ? [request.image.data.buffer] : [])
          : transfer;
        try {
          target.postMessage({ type: "generate", request }, buffers);
        } catch (error) {
          pending = null;
          reject(error);
        }
      });
    },

    /** 真取消：杀掉 Worker，在跑的那个立刻以 AbortError 结束（§29）。 */
    cancel(reason = "生成已取消") {
      const had = Boolean(pending);
      detach();
      settle("reject", new GenerationCancelledError(reason));
      return had;
    },

    /** 彻底释放（页面卸载 / 测试收尾）。 */
    dispose() {
      detach();
      pending = null;
      latestRequestId = null;
    },
  };
}
