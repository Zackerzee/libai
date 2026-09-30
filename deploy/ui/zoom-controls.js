import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEPS, zoomToSlider, sliderToZoom } from "../services/viewport-service.js?v=20260924-text";

// 「−」「+」按共享的 ZOOM_STEPS 跳档。
// 原来固定 ±25 个百分点：在 25% 下限时代已经够粗，下限降到 2% 后更是没法用
// （2% 按一次变 27%，等于直接跳过整个「看整幅」区间）。走档位表各区间手感才一致。
const stepFrom = (percent, direction) => {
  const current = percent / 100;
  const next = direction < 0
    ? [...ZOOM_STEPS].reverse().find((value) => value < current - 0.001)
    : ZOOM_STEPS.find((value) => value > current + 0.001);
  return (next ?? current) * 100;
};

export class ZoomControls {
  constructor({
    root,
    // 默认区间直接取自 viewport-service 的常量，避免两处各写一份后漂移：
    // 一旦 setZoom 夹的区间比 fitToViewport 允许的更窄，读数就会和真实缩放对不上。
    min = MIN_ZOOM * 100,
    max = MAX_ZOOM * 100,
    value = 100,
    onChange = () => {},
    onFit = () => {}
  }) {
    this.root =
      typeof root === "string"
        ? document.querySelector(root)
        : root;

    this.min = min;
    this.max = max;
    this.value = value;

    this.onChange = onChange;
    this.onFit = onFit;

    this.render();
    this.bindEvents();
  }

  render() {
    this.root.innerHTML = `
      <div class="sl-zoom-controls">

        <button
          type="button"
          data-action="fit"
          class="sl-zoom-fit"
          title="自动缩放并居中，完整显示整张图纸"
          aria-label="适应窗口"
        >
          适应窗口
        </button>

        <span class="sl-toolbar-divider"></span>

        <button
          type="button"
          data-action="zoom-out"
          aria-label="缩小"
        >
          −
        </button>

        <button
          type="button"
          class="sl-zoom-value"
          data-role="zoom-value"
        >
          ${Math.round(this.value)}%
        </button>

        <button
          type="button"
          data-action="zoom-in"
          aria-label="放大"
        >
          +
        </button>

        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value="${zoomToSlider(this.value / 100)}"
          data-role="zoom-slider"
          aria-label="缩放"
        />

      </div>
    `;
  }

  bindEvents() {
    this.root.addEventListener("click", event => {
      const action =
        event.target.closest("[data-action]")
          ?.dataset.action;

      switch (action) {
        case "fit":
          this.onFit();
          break;

        case "zoom-out":
          this.setZoom(stepFrom(this.value, -1));
          break;

        case "zoom-in":
          this.setZoom(stepFrom(this.value, 1));
          break;
      }
    });

    // 滑块是 0–100 的**对数**刻度（见 viewport-service 的 zoomToSlider）：
    // 线性刻度下 2%–100% 只占轨道前 12%，低倍段挤成一团点不准。
    this.root
      .querySelector('[data-role="zoom-slider"]')
      .addEventListener("input", event => {
        this.setZoom(
          sliderToZoom(Number(event.target.value)) * 100
        );
      });
  }

  setZoom(value, emit = true) {
    this.value = Math.max(
      this.min,
      Math.min(this.max, value)
    );

    this.root.querySelector(
      '[data-role="zoom-value"]'
    ).textContent = `${Math.round(this.value)}%`;

    this.root.querySelector(
      '[data-role="zoom-slider"]'
    ).value = zoomToSlider(this.value / 100);

    if (emit) {
      this.onChange(this.value);
    }
  }
}
