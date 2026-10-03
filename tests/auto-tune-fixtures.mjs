/**
 * §13 Auto Tune 测试共用夹具。
 *
 * 这里只放**被多个测试文件共用**的东西：合成源图、真管线执行器、
 * 手工构造的候选条目与硬约束上下文。
 *
 * ── 为什么要有「手工构造的条目」 ──────────────────────────────────────
 * `selectProfile` / `checkHardConstraints` 只读 `entry.metrics`、
 * `entry.profileId`、`entry.accepted`、`entry.runtimeMs`、`entry.nullMaskHash`。
 * 用真管线去凑出「挑战者只赢 0.005」这种边界，要靠调参数反复试，而且
 * 换一台机器就可能变；直接构造 metrics 才能把每条分支**钉死**。
 * 真管线的端到端路径由各文件里的 `realRunCandidate` 那几条覆盖。
 */
import { runGenerationPipeline } from "../services/generation-pipeline.mjs";
import { referenceFor, measureGrid } from "../services/quality-metrics.mjs";
import { AUTO_TUNE_DEFAULTS } from "../services/auto-tune.mjs";
import { benchPalette } from "./b4-bench-runner.mjs";

/** 合成源图（ImageData 形状）。`kind` 决定画什么，影响路由与指标。 */
export function syntheticSource(width = 48, height = 48, kind = "gradient") {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let r;
      let g;
      let b;
      if (kind === "flat") {
        r = 200; g = 60; b = 60;
      } else if (kind === "gradient") {
        const t = x / Math.max(1, width - 1);
        r = Math.round(20 + t * 200);
        g = Math.round(30 + t * 160);
        b = Math.round(180 - t * 120);
      } else if (kind === "checker") {
        const on = ((x >> 3) + (y >> 3)) % 2 === 0;
        r = on ? 250 : 10; g = on ? 250 : 10; b = on ? 250 : 10;
      } else {
        r = (x * 7 + y * 3) & 0xff; g = (y * 11) & 0xff; b = (x * 5) & 0xff;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * 调色板 —— **直接用冻结基线的色卡**，不自造。
 *
 * 自造一个小色卡看起来能让测试跑快一点，但会引入一个隐蔽的差异：
 * 色卡的 `group` 字段参与选色，自造色卡没有 group，
 * 测出来的就是「另一套色卡下的行为」。用同一份色卡，测试才有意义。
 */
export function tinyPalette() {
  return benchPalette();
}

/**
 * 真管线执行器：与生产同一份 `runGenerationPipeline`。
 * 用它测出来的才是「真行为」，不是「测试替身的行为」。
 */
export function makeRealRunCandidate({ source, palette = tinyPalette() } = {}) {
  return async ({ size, overrides, labCandidate, requestId, phase }) => {
    const t0 = Date.now();
    const result = runGenerationPipeline({
      image: source,
      mode: "auto",
      size,
      palette,
      maxColors: 0,
      overrides: labCandidate ? { ...overrides, labCandidate } : overrides,
    });
    return {
      grid: result.grid,
      width: result.width,
      height: result.height,
      diagnostics: result.diagnostics ?? null,
      timingMs: Math.max(0, Date.now() - t0),
      phase,
      requestId,
    };
  };
}

/** 真参考系 + 真指标键名。用来反查目标表/硬约束里写的指标名是否真实存在。 */
export function metricKeyProbe(width = 24, height = 24) {
  const source = syntheticSource(width * 4, height * 4, "gradient");
  const reference = referenceFor(source, width, height);
  const grid = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      row.push((x + y) % 7 === 0 ? null : { code: "A1", rgb: [200, 100, 50], hex: "#c86432" });
    }
    grid.push(row);
  }
  return { reference, keys: Object.keys(measureGrid(grid, reference)) };
}

/** 手工候选条目。`metrics` 只填用得上的键，其余缺省 —— 缺指标视为打平。 */
export function makeEntry(profileId, metrics = {}, extra = {}) {
  return {
    profileId,
    label: profileId,
    metrics,
    runtimeMs: 100,
    accepted: true,
    rejectReason: null,
    violations: [],
    nullMaskHash: "00000000",
    error: null,
    ...extra,
  };
}

/**
 * 硬约束上下文。`standard` 必填 —— 除 A/E/G 外的每条都是「相对 standard」。
 *
 * limits **从 `AUTO_TUNE_DEFAULTS` 派生**，不在这里抄一份数字。
 * 抄一份的后果是「往默认值里加一条门槛，测试却还在用旧的阈值」——
 * 测试会继续绿灯，而它测的已经不是生产行为了。
 */
export function makeCtx({ standard, limits = {}, effectiveMaxColors = 0, determinismVerified = null } = {}) {
  return {
    limits: { ...AUTO_TUNE_DEFAULTS, ...limits },
    standard,
    effectiveMaxColors,
    determinismVerified,
  };
}

/** 一个内容足够简单、跑得快的标准源图。 */
export function fastSource() {
  return syntheticSource(48, 48, "gradient");
}

/** 网格指纹（与评测工具同口径）。 */
export function gridHash(grid) {
  return grid.map((row) => row.map((cell) => (cell ? cell.code : "-")).join(",")).join(";");
}
