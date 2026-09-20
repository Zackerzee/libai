export class ZoomControls {
  constructor({
    root,
    min = 25,
    max = 800,
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
        >
          Fit
        </button>

        <span class="sl-toolbar-divider"></span>

        <button
          type="button"
          data-action="zoom-out"
        >
          −
        </button>

        <button
          type="button"
          class="sl-zoom-value"
          data-role="zoom-value"
        >
          ${this.value}%
        </button>

        <button
          type="button"
          data-action="zoom-in"
        >
          +
        </button>

        <input
          type="range"
          min="${this.min}"
          max="${this.max}"
          value="${this.value}"
          step="5"
          data-role="zoom-slider"
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
          this.setZoom(this.value - 25);
          break;

        case "zoom-in":
          this.setZoom(this.value + 25);
          break;
      }
    });

    this.root
      .querySelector('[data-role="zoom-slider"]')
      .addEventListener("input", event => {
        this.setZoom(
          Number(event.target.value)
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
    ).value = this.value;

    if (emit) {
      this.onChange(this.value);
    }
  }
}