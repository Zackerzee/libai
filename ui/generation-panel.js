import { GENERATION_MODE_PRESETS } from "../services/generation-pipeline.mjs";

/**
 * Shiliba Studio
 * Generation Settings Panel V2
 *
 * UI only.
 * Does NOT implement generation algorithms.
 *
 * Integration contract:
 *   onChange(nextSettings)
 *   onGenerate(settings)
 */

export class GenerationPanel {
  constructor({
    root,
    initialState = {},
    onChange = () => {},
    onGenerate = () => {}
  }) {
    this.root =
      typeof root === "string"
        ? document.querySelector(root)
        : root;

    if (!this.root) {
      throw new Error("GenerationPanel: root element not found.");
    }

    this.onChange = onChange;
    this.onGenerate = onGenerate;

    this.state = {
      preset: "auto",

      width: 104,
      height: 104,
      lockAspectRatio: false,

      sampling: "auto",

      detailProtection: 70,
      edgeProtection: 70,
      cleanupStrength: 50,

      preserveHighlights: true,
      preserveEyes: true,
      preserveMicroDetails: true,

      maxColors: 38,

      backgroundRemoval: false,

      // V2.5 智能辅助开关（默认全关，保持既有默认链路不变）
      subjectCrop: false,
      autoBackground: false,
      strokeProtection: false,
      accentProtection: false,

      brightness: 0,
      contrast: 0,
      saturation: 0,

      advancedOpen: true,

      ...initialState
    };

    this.render();
    this.bindEvents();
  }

  setState(patch, emit = true) {
    this.state = {
      ...this.state,
      ...patch
    };

    this.syncUI();

    if (emit) {
      this.onChange({ ...this.state });
    }
  }

  render() {
    this.root.innerHTML = `
      <section class="sl-generation-panel">

        ${this.renderGenMethodSection()}

        ${this.renderProtectionSection()}

        ${this.renderColorSection()}

        ${this.renderAdvancedSection()}

        <p class="sl-info-box">亮度、对比度、饱和度、旋转与裁剪请在「图片调整」中应用。</p>

      </section>
    `;

    this.syncUI();
  }

  // 普通界面只暴露场景模式；底层 sampling 由各模式内部映射，避免同一能力重复出现。
  // 图纸尺寸不在这里 —— 已提到工作台上方的顶栏，做成 52 / 78 / 104 / 自动 一行。
  renderGenMethodSection() {
    return `
      <div class="sl-panel-section">
        <div class="sl-section-heading">
          <div>
            <h3>生成模式</h3>
            <p>选择最接近原图内容的处理方式</p>
          </div>
        </div>

        <div class="sl-preset-grid">

          ${this.presetButton(
            "beginner",
            "小白一键",
            "全自动：裁主体 / 去背景 / 护描边",
            "★"
          )}

          ${this.presetButton(
            "auto",
            "智能",
            "自动分析图片",
            "✦"
          )}

          ${this.presetButton(
            "portrait",
            "人像",
            "面部与眼睛细节优先",
            "◉"
          )}

          ${this.presetButton(
            "anime",
            "动漫",
            "轮廓与高光保护",
            "◇"
          )}

          ${this.presetButton(
            "illustration",
            "插画",
            "稳定色块与边缘",
            "▰"
          )}

          ${this.presetButton(
            "pixel",
            "像素",
            "保持原始像素结构",
            "▦"
          )}

          ${this.presetButton(
            "logo",
            "Logo",
            "减少杂色与渐变",
            "⬡"
          )}

          ${this.presetButton(
            "photo",
            "写实",
            "保留照片的自然明暗",
            "◐"
          )}

        </div>

      </div>
    `;
  }

  presetButton(value, title, description, icon) {
    return `
      <button
        type="button"
        class="sl-preset-card"
        data-preset="${value}"
      >
        <span class="sl-preset-icon">${icon}</span>

        <span class="sl-preset-copy">
          <strong>${title}</strong>
          <small>${description}</small>
        </span>

        <span class="sl-preset-check">✓</span>
      </button>
    `;
  }

  renderProtectionSection() {
    return `
      <div class="sl-panel-section">

        <div class="sl-section-heading">
          <div>
            <h3>结构与细节保护</h3>
            <p>减少清理算法误删有价值的小区域</p>
          </div>
        </div>

        ${this.rangeControl(
          "detailProtection",
          "细节保护",
          "保护五官、饰品和少量关键色",
          0,
          100
        )}

        ${this.rangeControl(
          "edgeProtection",
          "边缘保护",
          "保持人物、动漫与物体轮廓",
          0,
          100
        )}

        <div class="sl-option-list">

          ${this.switchRow(
            "preserveEyes",
            "眼睛细节保护",
            "优先保护瞳孔、眼白和眼部结构"
          )}

          ${this.switchRow(
            "preserveHighlights",
            "高光保护",
            "保留眼睛高光和局部亮点"
          )}

          ${this.switchRow(
            "preserveMicroDetails",
            "微细节保护",
            "避免低频但有结构意义的颜色被合并"
          )}

        </div>

      </div>
    `;
  }

  renderColorSection() {
    return `
      <div class="sl-panel-section">

        <div class="sl-section-heading">
          <div>
            <h3>色彩整理</h3>
            <p>控制最终图纸颜色数量与杂色整理</p>
          </div>
        </div>

        <label class="sl-number-setting">
          <div>
            <strong>最大颜色数</strong>
            <small>0 = 自动 · 实际颜色数可能低于此值</small>
          </div>

          <div class="sl-number-stepper">

            <button
              type="button"
              data-step-field="maxColors"
              data-step="-1"
            >
              −
            </button>

            <input
              type="number"
              min="0"
              max="221"
              data-field="maxColors"
            />

            <button
              type="button"
              data-step-field="maxColors"
              data-step="1"
            >
              +
            </button>

          </div>
        </label>

        <div class="sl-info-box">
          <strong>关键细节不会只按使用数量删除</strong>

          <p>
            眼睛高光、瞳孔、嘴角等即使只使用 1–5 颗，
            也会交由细节保护规则判断，而不是直接作为杂色合并。
          </p>
        </div>

      </div>
    `;
  }

  renderAdvancedSection() {
    return `
      <div class="sl-panel-section sl-advanced-section">

        <div class="sl-section-heading">
          <div>
            <h3>更多设置</h3>
            <p>亮度、对比度、饱和度与智能辅助开关</p>
          </div>
        </div>

        <div
          class="sl-advanced-content"
          data-role="advanced-content"
        >

          ${this.rangeControl(
            "brightness",
            "亮度",
            "",
            -100,
            100
          )}

          ${this.rangeControl(
            "contrast",
            "对比度",
            "",
            -100,
            100
          )}

          ${this.rangeControl(
            "saturation",
            "饱和度",
            "",
            -100,
            100
          )}

          ${this.switchRow(
            "backgroundRemoval",
            "去除纯色背景",
            "仅作为生成前处理设置"
          )}

          <p class="sl-section-hint">
            智能辅助（可单独开关；「小白一键」会一次全开）
          </p>

          ${this.switchRow(
            "subjectCrop",
            "自动裁主体",
            "先裁到主体，让图案铺满画布"
          )}

          ${this.switchRow(
            "autoBackground",
            "自动留空背景",
            "只把与边框连通的浅色留成空豆"
          )}

          ${this.switchRow(
            "strokeProtection",
            "保护线稿描边",
            "描边位置不参与清理，避免糊线"
          )}

          ${this.switchRow(
            "accentProtection",
            "保护强调色",
            "降色时优先保留眼睛/高光等关键色"
          )}

        </div>

      </div>
    `;
  }

  rangeControl(field, title, description, min, max) {
    return `
      <div class="sl-range-setting">

        <div class="sl-range-heading">
          <div>
            <strong>${title}</strong>
            ${
              description
                ? `<small>${description}</small>`
                : ""
            }
          </div>

          <output data-output="${field}">
            0
          </output>
        </div>

        <div class="sl-range-row">

          <button
            type="button"
            data-range-step="${field}"
            data-step="-1"
          >
            −
          </button>

          <input
            type="range"
            min="${min}"
            max="${max}"
            step="1"
            data-field="${field}"
          />

          <button
            type="button"
            data-range-step="${field}"
            data-step="1"
          >
            +
          </button>

        </div>

      </div>
    `;
  }

  switchRow(field, title, description) {
    return `
      <label class="sl-switch-row">

        <span>
          <strong>${title}</strong>
          <small>${description}</small>
        </span>

        <input
          type="checkbox"
          data-field="${field}"
        />

        <span class="sl-switch-ui"></span>

      </label>
    `;
  }

  bindEvents() {
    this.root.addEventListener("click", event => {
      const preset = event.target.closest("[data-preset]");

      if (preset) {
        this.applyPreset(preset.dataset.preset);
        return;
      }

      const stepper = event.target.closest("[data-step-field]");

      if (stepper) {
        const field = stepper.dataset.stepField;
        const step = Number(stepper.dataset.step);

        this.setState({
          [field]: Math.max(
            0,
            Number(this.state[field]) + step
          )
        });

        return;
      }

      const rangeStepper =
        event.target.closest("[data-range-step]");

      if (rangeStepper) {
        const field = rangeStepper.dataset.rangeStep;
        const step = Number(rangeStepper.dataset.step);

        const input =
          this.root.querySelector(
            `[data-field="${field}"]`
          );

        const min = Number(input.min);
        const max = Number(input.max);

        const next = Math.min(
          max,
          Math.max(
            min,
            Number(this.state[field]) + step
          )
        );

        this.setState({
          [field]: next
        });

        return;
      }

      const action =
        event.target.closest("[data-action]");

      if (!action) return;

      switch (action.dataset.action) {
        case "generate":
          this.onGenerate({
            ...this.state
          });
          break;
      }
    });

    this.root.addEventListener("input", event => {
      const field = event.target.dataset.field;

      if (!field) return;

      let value;

      if (event.target.type === "checkbox") {
        value = event.target.checked;
      } else {
        value = Number(event.target.value);
      }

      this.state[field] = value;

      this.syncUI();

      this.onChange({
        ...this.state
      });
    });
  }

  applyPreset(preset) {
    const presets = /* legacy fallback removed: centralized below */ null;
    /*
      // 小白一键：面向新手的一步到位。除参数档位偏保守外，四个智能辅助开关一次全开。
      beginner: {
        sampling: "auto",
        detailProtection: 80,
        edgeProtection: 90,
        cleanupStrength: 45,
        preserveEyes: true,
        preserveHighlights: true,
        preserveMicroDetails: true,
        subjectCrop: true,
        autoBackground: true,
        strokeProtection: true,
        accentProtection: true
      },

      auto: {
        sampling: "auto",
        detailProtection: 70,
        edgeProtection: 70,
        cleanupStrength: 50,
        preserveEyes: true,
        preserveHighlights: true,
        preserveMicroDetails: true,
        subjectCrop: false,
        autoBackground: false,
        strokeProtection: false,
        accentProtection: false
      },

      portrait: {
        sampling: "edge",
        detailProtection: 90,
        edgeProtection: 75,
        cleanupStrength: 35,
        preserveEyes: true,
        preserveHighlights: true,
        preserveMicroDetails: true,
        subjectCrop: false,
        autoBackground: false,
        strokeProtection: false,
        accentProtection: false
      },

      anime: {
        sampling: "dominant",
        detailProtection: 90,
        edgeProtection: 90,
        cleanupStrength: 45,
        preserveEyes: true,
        preserveHighlights: true,
        preserveMicroDetails: true,
        subjectCrop: false,
        autoBackground: false,
        strokeProtection: false,
        accentProtection: false
      },

      illustration: {
        sampling: "dominant",
        detailProtection: 70,
        edgeProtection: 85,
        cleanupStrength: 55,
        preserveEyes: false,
        preserveHighlights: true,
        preserveMicroDetails: true,
        subjectCrop: false,
        autoBackground: false,
        strokeProtection: false,
        accentProtection: false
      },

      pixel: {
        sampling: "center",
        detailProtection: 100,
        edgeProtection: 100,
        cleanupStrength: 10,
        preserveEyes: true,
        preserveHighlights: true,
        preserveMicroDetails: true,
        subjectCrop: false,
        autoBackground: false,
        strokeProtection: false,
        accentProtection: false
      },

      logo: {
        sampling: "dominant",
        detailProtection: 35,
        edgeProtection: 95,
        cleanupStrength: 85,
        preserveEyes: false,
        preserveHighlights: false,
        preserveMicroDetails: false,
        subjectCrop: false,
        autoBackground: false,
        strokeProtection: false,
        accentProtection: false
      },

      photo: {
        sampling: "mean",
        detailProtection: 70,
        edgeProtection: 70,
        cleanupStrength: 50,
        preserveEyes: true,
        preserveHighlights: true,
        preserveMicroDetails: true,
        subjectCrop: false,
        autoBackground: false,
        strokeProtection: false,
        accentProtection: false
      }
    }; */

    const centralized = GENERATION_MODE_PRESETS[preset];
    this.setState({
      preset,
      ...(centralized ? { ...centralized, sampling: ({ "edge-aware":"edge", "linear-mean":"mean" })[centralized.sampling] || centralized.sampling } : {})
    });
  }

  syncUI() {
    this.root
      .querySelectorAll("[data-field]")
      .forEach(input => {
        const field = input.dataset.field;

        if (!(field in this.state)) return;

        if (input.type === "checkbox") {
          input.checked = Boolean(this.state[field]);
        } else {
          input.value = this.state[field];
        }
      });

    this.root
      .querySelectorAll("[data-output]")
      .forEach(output => {
        const field = output.dataset.output;

        output.textContent =
          `${this.state[field]}${field.includes("Protection") ||
          field === "cleanupStrength"
            ? "%"
            : ""}`;
      });

    this.root
      .querySelectorAll("[data-preset]")
      .forEach(button => {
        button.classList.toggle(
          "is-active",
          button.dataset.preset === this.state.preset
        );
      });

    const advanced =
      this.root.querySelector(
        '[data-role="advanced-content"]'
      );

    const advancedLabel =
      this.root.querySelector(
        '[data-role="advanced-label"]'
      );

    advanced?.classList.toggle(
      "is-open",
      this.state.advancedOpen
    );

    if (advancedLabel) {
      advancedLabel.textContent =
        this.state.advancedOpen
          ? "收起"
          : "展开";
    }
  }
}
