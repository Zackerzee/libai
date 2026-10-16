import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEPS, zoomToSlider, sliderToZoom } from "../services/viewport-service.js?v=20261015-dynamic-zoom-1";

// 「−」「+」按共享的 ZOOM_STEPS 跳档。
// 原来固定 ±25 个百分点：在 25% 下限时代已经够粗，下限降到 2% 后更是没法用
// （2% 按一次变 27%，等于直接跳过整个「看整幅」区间）。走档位表各区间手感才一致。
// floor 是动态下限（大作品能缩到适屏比例，小作品仍是 20%）——
// 档位表里低于 floor 的档位要过滤掉，否则「−」按下去读数原地不动，像按钮坏了。
// 没有更低的档位时**落到下限**（fit 出来的 3.52% 这类非档位值要能回到下限），
// 绝不允许回退到 `current`——读数 4% 是 3.52% 取整来的，按「−」却跳到 4%
// 等于越按越大，那就把「缩小」按钮变成了「放大」按钮。
export const stepFrom = (percent, direction, floor) => {
  const current = percent / 100;
  const steps = ZOOM_STEPS.filter((value) => value >= floor / 100 - 0.0001);
  const next = direction < 0
    ? [...steps].reverse().find((value) => value < current - 0.001)
    : steps.find((value) => value > current + 0.001);
  if (next != null) return next * 100;
  if (direction < 0 && current > floor / 100 + 0.0001) return floor;
  return percent;
};

export class ZoomControls {
  constructor({
    root,
    // 默认区间直接取自 viewport-service 的常量，避免两处各写一份后漂移：
    // 一旦 setZoom 夹的区间比 fitToViewport 允许的更窄，读数就会和真实缩放对不上。
    min = MIN_ZOOM * 100,
    max = MAX_ZOOM * 100,
    // floor：动态下限（百分数）。可以是数字，也可以是 getter —— 大作品的
    // 下限随适屏比例走，每次交互都得重新问一次，所以用 getter。
    floor = MIN_ZOOM * 100,
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
    this.floor = floor;
    this.value = value;

    this.onChange = onChange;
    this.onFit = onFit;

    this.render();
    this.bindEvents();
  }

  // 当前下限（百分数）。getter 每次都求值，静态数字也能用。
  currentFloor() {
    return typeof this.floor === "function" ? Number(this.floor()) : Number(this.floor);
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
          value="${zoomToSlider(this.value / 100, this.currentFloor() / 100)}"
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
          this.setZoom(stepFrom(this.value, -1, this.currentFloor()));
          break;

        case "zoom-in":
          this.setZoom(stepFrom(this.value, 1, this.currentFloor()));
          break;
      }
    });

    // 滑块是 0–100 的**对数**刻度（见 viewport-service 的 zoomToSlider）：
    // 线性刻度下 2%–100% 只占轨道前 12%，低倍段挤成一团点不准。
    this.root
      .querySelector('[data-role="zoom-slider"]')
      .addEventListener("input", event => {
        this.setZoom(
          sliderToZoom(Number(event.target.value), this.currentFloor() / 100) * 100
        );
      });
  }

  setZoom(value, emit = true) {
    this.value = Math.max(
      Math.max(this.min, this.currentFloor()),
      Math.min(this.max, value)
    );

    this.root.querySelector(
      '[data-role="zoom-value"]'
    ).textContent = `${Math.round(this.value)}%`;

    this.root.querySelector(
      '[data-role="zoom-slider"]'
    ).value = zoomToSlider(this.value / 100, this.currentFloor() / 100);

    if (emit) {
      this.onChange(this.value);
    }
  }
}
