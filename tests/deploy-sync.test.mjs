/**
 * deploy/ 发布目录漂移检测。
 *
 * 为什么需要它：netlify.toml 里 publish = "deploy"，而 deploy/ 是手工维护的副本。
 * 2026-09-22 出过一次事故 —— deploy/ 缺了 styles/pixler-skin.css 与
 * vendor/fusion-pixel/（81 个文件），index.html / app.js / ui/workspace.js 也是旧版。
 * 源码里做好的整套皮肤，一发布就会消失。而当时全部单测都是绿的，
 * 因为**没有任何测试看一眼 deploy/**。
 *
 * 判定口径：
 *   - `added`（deploy 缺文件）与 `updated`（deploy 是旧版）→ **硬失败**。
 *     这两类会让线上缺资源或跑旧代码，是真正的故障。
 *   - `extra`（deploy 里的多余文件）→ 不失败，只在输出里提示。
 *     它们是体积与信息暴露问题，不是功能故障，且清理属于破坏性操作，
 *     该由人确认，不该由测试替人做决定。
 *
 * 修法：node tools/sync-deploy.mjs（同步）/ --check（只看差异）/ --prune（连多余文件一起清）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { plan } from "../tools/sync-deploy.mjs";

const p = plan();

test("deploy：源码里的文件不能在发布目录缺失", () => {
  assert.deepEqual(p.added, [], `deploy/ 缺少 ${p.added.length} 个文件，线上会 404`);
});

test("deploy：发布目录不能是源码的旧版本", () => {
  assert.deepEqual(p.updated, [], `deploy/ 有 ${p.updated.length} 个文件内容落后于源码`);
});

test("deploy：收录清单不是空的（防止清单写错导致假通过）", () => {
  assert.ok(p.total > 100, `清单只收录了 ${p.total} 个文件，明显不对`);
});

test("deploy：多余文件只提示不失败", () => {
  if (p.extra.length) {
    console.log(
      `[提示] deploy/ 有 ${p.extra.length} 个多余文件（不影响功能，可用 --prune 清理）：\n  ` +
        p.extra.slice(0, 10).join("\n  ") +
        (p.extra.length > 10 ? `\n  ...还有 ${p.extra.length - 10} 个` : ""),
    );
  }
  assert.ok(true);
});
