import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 用户 2026-10-16 报「黑暗模式下有好几个地方的按钮都这样（浅底白字看不清）」，
 * 附图为导出抽屉里的「作品海报 · PNG」（奶油底白字）。审核后确认是**两件独立的事**：
 *
 * A. 层叠覆盖（真正的 1:1 级故障）
 *    studio-system.css 里两条「把 studio 皮肤套到工作台按钮上」的归一化规则用
 *    `:is(.ws-button, …)` 一口气选中了所有 .ws-button，把 `.ws-button-primary` 的
 *    accent 底压成 surface 底；字色仍来自 `.ws-button-primary{color:var(--ds-color-on-accent)}`：
 *      亮色：底 #ffffff + 字 #ffffff = 1.0
 *      暗色：底 #201f1a + 字 #171612 = 1.1
 *    实测受害者 #inv-deduct「按当前图纸扣料」。
 *    排除手法固定为 `:where(:not(.ws-button-primary))` —— **不要**改写成裸 `:not(...)`：
 *    `:not()` 会把特异性从 (0,2,2) 抬到 (0,3,1)，这条归一化会反超原本赢过它的规则，
 *    波及所有 `.ws-context-group button` 之类的元素。`:where()` 贡献 0 特异性，
 *    层叠逐位不变，只改「谁被这条命中」。
 *
 * B. 弱文本令牌越界（可读性下限）
 *    `.ws-usage-sort button` 用 muted-2 令牌，亮色下 #9a968d on #ffffff = 2.95，
 *    低于 3:1 的可读下限。降一档到 secondary 即可（亮 5.7 / 暗 6.4）。
 */
const studio = readFileSync(new URL('../styles/studio-system.css', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../styles/workspace.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

test('工作台通用按钮归一化必须排除主色按钮（否则 accent 底被 surface 压掉）', () => {
  const rule = studio.split('\n').find((line) => line.includes(':is(.ws-button') && line.includes('--ds-color-surface'));
  assert.ok(rule, 'studio-system.css 里应仍存在把 .ws-button 归一化为 surface 底的规则');
  assert.match(rule, /\.ws-button:where\(:not\(\.ws-button-primary\)\)/, `必须用 :where(:not(...)) 排除主色按钮，实际：${rule}`);
  assert.doesNotMatch(rule, /:is\(\.ws-button,/, '不能再用裸 :is(.ws-button,…) 一口气选中所有按钮');
});

test('顶栏幽灵按钮归一化同样必须排除主色按钮', () => {
  const rule = studio.split('\n').find((line) => line.includes('.ws-topbar :is(button,summary)') && line.includes('--ds-color-text-secondary'));
  assert.ok(rule, 'studio-system.css 里应仍存在顶栏幽灵按钮规则');
  assert.match(rule, /:where\(:not\(\.ws-button-primary\)\)/, `顶栏规则也必须排除主色按钮，实际：${rule}`);
});

test('主色按钮的字色只能来自 on-accent 令牌', () => {
  const rule = workspace.split('\n').find((line) => line.startsWith('.ws-button-primary {'));
  assert.ok(rule, 'workspace.css 应定义 .ws-button-primary');
  assert.match(rule, /color: var\(--ds-color-on-accent\)/);
  assert.doesNotMatch(rule, /color:\s*(#fff\b|#ffffff\b|white\b)/i, 'accent 底上禁止硬编码白字（暗色下看不见）');
});

test('两个主题的 accent 与 on-accent 都必须互不相同（同色即对比度 1:1）', () => {
  const readScope = (scope) => {
    const start = tokens.indexOf(scope);
    assert.ok(start >= 0, `tokens.css 应存在作用域 ${scope}`);
    const block = tokens.slice(start, tokens.indexOf('}', start));
    const pick = (name) => (block.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();
    return { accent: pick('ds-color-accent'), onAccent: pick('ds-color-on-accent') };
  };
  const cases = [['暗色', ':root[data-theme="dark"] {'], ['亮色', ':root {']];
  for (const [label, scope] of cases) {
    const { accent, onAccent } = readScope(scope);
    assert.ok(accent && onAccent, `${label}主题必须同时定义 accent 与 on-accent`);
    assert.notEqual(accent.toLowerCase(), onAccent.toLowerCase(), `${label}主题 accent 与 on-accent 不能同色`);
  }
});

test('底栏排序按钮不得使用最弱的 muted-2 令牌（亮色下只有 2.95:1）', () => {
  const rule = workspace.split('\n').find((line) => line.startsWith('.ws-usage-sort button {'));
  assert.ok(rule, 'workspace.css 应定义 .ws-usage-sort button');
  assert.doesNotMatch(rule, /color:\s*var\(--ws-text-tertiary\)/, `排序按钮用 muted-2 会在亮色下掉到 2.95:1，实际：${rule}`);
  assert.match(rule, /color:\s*var\(--ws-text-secondary\)/);
});
