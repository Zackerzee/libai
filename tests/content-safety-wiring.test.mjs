/**
 * 内容审查链路接线契约测试。
 *
 * 为什么需要它：nsfwjs 4.x 的浏览器版**不自带模型**，需要按
 * 「模型元数据 → 权重分片 → 主包」的顺序挂三个 script 才能 load()。
 * 这四处路径任意一处写错，loadLocalSafetyModel() 都会 catch 住异常并
 * 返回 null，runLocalContentSafetyCheck() 随即返回 { allowed: true, skipped: true }
 * —— 也就是**静默放行**。没有报错、没有告警，界面一切正常，审查却完全失效。
 *
 * 2026-09-22 就踩过这个坑：NSFWJS_SCRIPT_URL 写成 dist/nsfwjs.min.js（404）。
 * 这里把路径与加载顺序钉住，防止再次静默退化。
 *
 * 默认只做静态契约校验（不联网）。设 LIBMS_NET_TESTS=1 时额外做真实 HEAD 探测。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "app.js"), "utf8");

const pick = (name) => {
  const m = APP.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(m, `app.js 中找不到常量 ${name}`);
  // 常量里可能引用 NSFWJS_CDN，把模板串展开成真实字面量
  return m[1]
    .replace(/`/g, "")
    .replace(/\$\{NSFWJS_CDN\}/g, "https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist")
    .replace(/^"|"$/g, "")
    .trim();
};

test("审查：nsfwjs 主包必须走 dist/browser/（dist/ 根下会 404）", () => {
  const url = pick("NSFWJS_SCRIPT_URL");
  assert.equal(url, "https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/browser/nsfwjs.min.js");
  assert.ok(!/\/dist\/nsfwjs\.min\.js$/.test(url), "不能退回 dist/nsfwjs.min.js（该路径不存在）");
});

test("审查：模型元数据与权重分片路径必须成对存在且同属 mobilenet_v2", () => {
  const model = pick("NSFWJS_MODEL_URL");
  const weights = pick("NSFWJS_WEIGHTS_URL");
  assert.equal(model, "https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/models/mobilenet_v2/model.min.js");
  assert.equal(weights, "https://cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/models/mobilenet_v2/group1-shard1of1.min.js");
  assert.equal(
    model.slice(0, model.lastIndexOf("/")),
    weights.slice(0, weights.lastIndexOf("/")),
    "模型与权重必须来自同一目录，否则 nsfwjs 组不出图",
  );
});

test("审查：加载顺序必须是 模型 → 权重 → 主包", () => {
  const body = APP.slice(APP.indexOf("async function loadLocalSafetyModel"));
  const order = ["NSFWJS_MODEL_URL", "NSFWJS_WEIGHTS_URL", "NSFWJS_SCRIPT_URL"]
    .map((name) => body.indexOf(`loadScriptOnce(${name})`));
  for (const [i, at] of order.entries()) {
    assert.ok(at >= 0, `loadLocalSafetyModel() 没有加载 ${["模型", "权重", "主包"][i]}`);
  }
  assert.ok(order[0] < order[1] && order[1] < order[2], "顺序错了 nsfwjs.load() 必然抛 Could not load the model");
});

test("审查：nsfwjs.load() 之前必须先挂上三个 script", () => {
  const body = APP.slice(APP.indexOf("async function loadLocalSafetyModel"));
  const loadAt = body.indexOf("window.nsfwjs.load(");
  assert.ok(loadAt > 0, "找不到 nsfwjs.load() 调用");
  for (const name of ["NSFWJS_MODEL_URL", "NSFWJS_WEIGHTS_URL", "NSFWJS_SCRIPT_URL"]) {
    assert.ok(body.indexOf(`loadScriptOnce(${name})`) < loadAt, `${name} 必须在 load() 之前挂载`);
  }
});

test("审查：3.4 MB 权重不能被 8 秒级超时卡死", () => {
  const t = Number(APP.match(/const SAFETY_SCRIPT_LOAD_TIMEOUT = (\d+);/)?.[1]);
  assert.ok(Number.isFinite(t), "找不到 SAFETY_SCRIPT_LOAD_TIMEOUT");
  assert.ok(t >= 15000, `脚本超时 ${t}ms 对 3.4 MB 权重过短，会静默放行`);
  assert.ok(t <= 30000, `脚本超时 ${t}ms 过长，用户会长时间停在「本地审查中」`);
});

test("审查：CDN 上四个资源真实可达", { skip: process.env.LIBMS_NET_TESTS !== "1" ? "设 LIBMS_NET_TESTS=1 启用联网探测" : false }, async () => {
  const urls = [pick("TFJS_SCRIPT_URL"), pick("NSFWJS_MODEL_URL"), pick("NSFWJS_WEIGHTS_URL"), pick("NSFWJS_SCRIPT_URL")];
  for (const url of urls) {
    const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-64" } });
    assert.ok(res.ok, `${url} 返回 ${res.status}`);
    assert.match(res.headers.get("content-type") || "", /javascript/, `${url} 的 MIME 不是 javascript，会被严格 MIME 校验拦下`);
  }
});
