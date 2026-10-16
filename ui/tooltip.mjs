// 即时 tooltip：鼠标悬停图标 → 含义立刻显现（进入 0s 瞬显，离开 140ms 淡回）。
// 满足三条交互规则的落点：① 进入立即（.is-on 上 transition-duration:0s）、
// 离开淡回（移除 .is-on 回到基准 140ms 过渡）；② 用 opacity 而非 display，
// pointer-events:none 不挡操作，focusin/focusout 让键盘也能触发；
// 浮层挂在 body 上，绕开 ws-top-controls 的 overflow:hidden 裁剪。

let installed = false;

export function initTooltip() {
  if (installed) return;
  // 非浏览器环境（Node 单测 `import '../ui/workspace.js'`）直接跳过。缺了这行守卫，
  // 凡是 import workspace.js 的测试文件都会在【导入期】抛 "document is not defined"，
  // 整份测试一条断言都跑不到 —— 守卫全变成死代码。
  // 只判 typeof document：真浏览器里若连 body 都拿不到，就应该大声抛错，
  // 不能在这里静默不装 tooltip（那正是本项目最怕的静默失效）。
  // 注意别在 return 前把 installed 置 true —— 浏览器侧仍要真正装上。
  if (typeof document === "undefined") return;
  installed = true;

  const tip = document.createElement('div');
  tip.className = 'ws-tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  let hideTimer = 0;

  // 自动接管：凡带 title 未带 data-tip 的元素，一律把 title 转成 data-tip 并移除原生 title
  // （原生 title 有 ~500ms 延后才弹，且会和本项目即时 tooltip 重影）。这样工具栏二级菜单、
  // 对称按钮、主题/尺寸按钮等无需逐处改造，新渲染的按钮也会被 MutationObserver 自动覆盖。
  // 这些按钮普遍同时带 aria-label，移除 title 不影响读屏。
  const adoptNode = (node) => {
    if (!(node instanceof Element)) return;
    const adopt = (el) => {
      const t = el.getAttribute('title');
      if (t && t.trim()) { el.setAttribute('data-tip', t); el.removeAttribute('title'); }
    };
    if (node.matches && node.matches('[title]:not([data-tip])')) adopt(node);
    if (node.querySelectorAll) node.querySelectorAll('[title]:not([data-tip])').forEach(adopt);
  };
  const adoptAll = () => document.body.querySelectorAll('[title]:not([data-tip])').forEach((el) => {
    const t = el.getAttribute('title');
    if (t && t.trim()) { el.setAttribute('data-tip', t); el.removeAttribute('title'); }
  });
  adoptAll();
  new MutationObserver((muts) => {
    for (const m of muts) { for (const n of m.addedNodes) adoptNode(n); }
  }).observe(document.body, { subtree: true, childList: true });

  const place = (el) => {
    const text = el.getAttribute('data-tip');
    if (!text) return false;
    tip.textContent = text;
    tip.classList.add('is-on'); // 进入瞬显：CSS 在 .is-on 上将过渡时长置 0
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    let y = r.bottom + 8; // 默认显示在下方（顶栏靠视口上沿）
    if (y + tr.height > window.innerHeight - 8) y = r.top - tr.height - 8; // 放不下翻到上方
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(x, window.innerWidth - tr.width - 8));
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    return true;
  };

  const show = (el) => {
    if (!el || !el.hasAttribute('data-tip')) return;
    clearTimeout(hideTimer);
    place(el);
  };
  const hide = () => {
    // 离开后 140ms 再淡出，符合“离开 140ms 淡回”
    hideTimer = setTimeout(() => tip.classList.remove('is-on'), 140);
  };

  document.addEventListener('mouseover', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) show(el);
  }, true);
  document.addEventListener('mouseout', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) hide();
  }, true);
  document.addEventListener('focusin', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) show(el);
  }, true);
  document.addEventListener('focusout', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) hide();
  }, true);
  // 滚动时收起，避免浮层与源元素错位
  window.addEventListener('scroll', () => {
    if (tip.classList.contains('is-on')) tip.classList.remove('is-on');
  }, true);
}
