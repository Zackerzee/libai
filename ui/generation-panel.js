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
    backgroundRoot = null,
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
    this.backgroundRoot = typeof backgroundRoot === "string" ? document.querySelector(backgroundRoot) : backgroundRoot;
    this.onGenerate = onGenerate;

    this.state = {
      preset: "auto",

      // 注意：**尺寸不在这里**，但它现在住在同一个「生成」Tab 里。
      // 生成尺寸的唯一自由度是「长边格数」，由 workspace.js 的「生成尺寸」一节
      // （#ws-size-range / #ws-size-number / #ws-size-apply）+ bridge 单独持有，
      // 见 services/generation-size.mjs。
      // 它**故意不并入本面板的 state**：放进来就会和 onChange 连成一条
      // 「拖尺寸 = 立刻重算」的风暴，也会和「图纸尺寸」（编辑器里的 grid resize）
      // 串成一条链路。Stage C0 只是把两个控件放进了同一个 Tab，
      // 没有合并它们的数据通路 —— 这是两件不同的事。

      sampling: "auto",

      detailProtection: 70,
      edgeProtection: 70,
      cleanupStrength: 50,

      preserveHighlights: true,
      preserveEyes: true,
      preserveMicroDetails: true,

      maxColors: 38,

      // ── 去背景：**界面上只有一个开关**（Stage B2 §17 §18）──────────────
      // 以前这里是两个字段两个开关：「去除纯色背景」(backgroundRemoval，写了没人读，
      // 是个死开关) 和「自动留空背景」(autoBackground，真正接进生成引擎的那个)。
      // 用户看到两个意思相近的开关、只有一个有效 —— 这是明确的产品缺陷。
      // 现在 `backgroundRemoval` 是**唯一可见**的开关，`autoBackground` 降级为
      // 它发往引擎的镜像（见 emitSettings()）。引擎协议不变。
      //
      // ⚠️ 面板 state 里**故意不声明** `autoBackground`（Stage B5 §20 删掉的）。
      // 它曾经在这里有一个 `false` 初值，但从来没有 `[data-field="autoBackground"]`
      // 去绑它、也没有任何逻辑读它 —— `emitSettings()` 是用**局部变量**
      // `backgroundRemoval` 现算镜像值的。那个初值是个写不到也读不回的字段，
      // 留着只会让人以为面板有两份背景状态。
      // 真正活的那个 `autoBackground` 在 `state/store.js` 的 `generation` 槽里。
      backgroundRemoval: false,

      // V2.5 智能辅助开关（默认全关，保持既有默认链路不变）
      subjectCrop: false,
      strokeProtection: false,
      accentProtection: false,

      brightness: 0,
      contrast: 0,
      saturation: 0,

      advancedOpen: false,

      ...initialState
    };

    this.render();
    this.bindEvents();
  }

  /**
   * 面板发往工作台的设置快照。
   *
   * Stage B2 §17 §18：`autoBackground` 是 `backgroundRemoval` 的**镜像** ——
   * 生成引擎读的是 `autoBackground`，界面读的是 `backgroundRemoval`。
   * 两者必须在同一个函数里一起翻转，否则会出现「开关显示关着、引擎却真的去抠背景」
   * 这种最难查的状态分叉。
   */
  emitSettings() {
    const backgroundRemoval = Boolean(this.state.backgroundRemoval);
    return { ...this.state, backgroundRemoval, autoBackground: backgroundRemoval };
  }

  setState(patch, emit = true) {
    this.state = {
      ...this.state,
      ...patch
    };

    this.syncUI();

    if (emit) {
      this.onChange(this.emitSettings());
    }
  }

  render() {
    const paletteSelector = this.root.querySelector("#ws-brand-selector");
    this.root.innerHTML = `
      <section class="sl-generation-panel">

        <div class="sl-panel-section" id="ws-generation-background-controls">
          ${this.switchRow(
            "backgroundRemoval",
            "透明背景",
            "生成时识别并去除可安全分离的纯色背景；复杂背景不强行删除"
          )}
        </div>

        ${this.renderActionSection()}

        ${this.renderGenMethodSection()}

        ${this.renderColorSection()}

        ${this.renderAdvancedSection()}

        <p class="sl-info-box">亮度、对比度、饱和度、旋转与裁剪请在「图片调整」中应用。</p>

      </section>
    `;

    if (paletteSelector) this.root.querySelector("#ws-generation-palette-slot").append(paletteSelector);
    // Re-render replaces the same single switch; the external host keeps its
    // delegated listener and never holds a second settings/state copy.
    if (this.backgroundRoot) this.backgroundRoot.replaceChildren(this.root.querySelector("#ws-generation-background-controls"));
    this.syncUI();
  }

  /**
   * Stage C0 §4：主要动作「重新生成」。
   *
   * 这个按钮**之前根本不存在**：`bindEvents()` 里一直有 `case "generate"` 分支、
   * workspace.js 也一直传着 `onGenerate`（含「覆盖手动修改」确认），
   * 但 render() 从来没有渲染出任何 `[data-action="generate"]` 元素 ——
   * 于是那条分支和那个回调都是够不到的死代码。
   * 生成期间由 workspace.js 的 paint() 把这里 disable 掉（`#ws-generation-regenerate`）。
   */
  renderActionSection() {
    return `
      <div class="sl-panel-section sl-action-section">
        <button type="button" class="sl-primary-action" id="ws-generation-regenerate" data-action="generate">
          <strong>重新生成</strong>
          <small>按当前设置重算整张图纸</small>
        </button>
      </div>
    `;
  }

  // 普通界面只暴露场景模式；底层 sampling 由各模式内部映射，避免同一能力重复出现。
  // 生成尺寸也不在这里 —— 它和本面板同在「生成」Tab，但由 workspace.js 的
  // 「生成尺寸」一节独立持有（草稿 +「应用尺寸」显式提交，B0 §7 / Stage C0 §7）。
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

        <div id="ws-generation-palette-slot"></div>

        <!-- Stage C0 §6：0 这个内部哨兵值不再直接甩给用户看。
             以前这一节只有一个数字框，标题是个内部字段名、提示要求用户先把 0
             理解成「自动」，等于把实现细节当成产品语言。
             现在档位按钮 + 读数说人话（「不限制」/「最多 24 色」），
             数字框保留为自定义入口；data-field="maxColors" 与 0..221 的取值区间
             都没变 —— 生成侧一条限制都没新增，改的只是显示层。
             注意：这里是模板字面量内部，注释里不能出现反引号（会提前闭合模板）。 -->
        <div class="sl-color-presets" role="group" aria-label="颜色数量档位">
          ${[["0", "不限制"], ["8", "8"], ["16", "16"], ["24", "24"], ["38", "38"], ["64", "64"]]
            .map(([value, label]) => `<button type="button" data-color-cap="${value}">${label}</button>`)
            .join("")}
        </div>

        <label class="sl-number-setting">
          <div>
            <strong>颜色数量</strong>
            <small>限制最终图纸的用色数；不限制时由算法自行决定</small>
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

        <p class="sl-number-readout" id="ws-color-cap-readout">不限制</p>

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
            <p>主体裁剪与结构保护；色调请在「图片调整」中处理</p>
          </div>
        </div>

        <button type="button" data-action="toggle-advanced" aria-expanded="false"><span data-role="advanced-label">展开</span>高级设置</button>
        <div
          class="sl-advanced-content"
          data-role="advanced-content"
        >
          ${this.renderProtectionSection()}

          <p class="sl-section-hint">
            智能辅助（可单独开关；「小白一键」会一次全开）
          </p>

          ${this.switchRow(
            "subjectCrop",
            "自动裁主体",
            "先裁到主体，让图案铺满画布"
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
      if(event.target.closest('[data-action="toggle-advanced"]')){this.setState({advancedOpen:!this.state.advancedOpen});return;}
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

      // Stage C0 §6：档位按钮 = 对 maxColors 的一次显式赋值，走同一条 setState，
      // 不新增任何旁路状态。「不限制」档就是 0，和数字框里手动填 0 完全等价。
      const colorCap = event.target.closest("[data-color-cap]");

      if (colorCap) {
        this.setState({ maxColors: Number(colorCap.dataset.colorCap) || 0 });
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

    const onInput = event => {
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

      this.onChange(this.emitSettings());
    };
    this.root.addEventListener("input", onInput);
    this.backgroundRoot?.addEventListener("input", onInput);
  }

  applyPreset(preset) {
    // Stage B5 §20：这里原来内联着一整张旧 presets 表（8 个模式 × 完整生成配置），
    // 以及一个 `const presets = null` 的死变量。两者都没有任何读者 ——
    // 真正生效的是下面那行 `GENERATION_MODE_PRESETS[preset]`。
    // 留着注释表的唯一后果是：改模式参数的人会先看到一份**已经失效**的副本，
    // 改完发现没生效，再去追为什么。模式表只有 services/mode-profile.mjs 一份。

    const centralized = GENERATION_MODE_PRESETS[preset];
    const patch = centralized
      ? { ...centralized, sampling: ({ "edge-aware":"edge", "linear-mean":"mean" })[centralized.sampling] || centralized.sampling }
      : {};
    // 「小白一键」会把四个智能辅助一次全开 —— 其中「去背景」必须落到
    // **唯一可见**的那个开关上，否则预设开了、界面却显示关着。
    if (centralized && "autoBackground" in centralized) {
      patch.backgroundRemoval = Boolean(centralized.autoBackground);
    }
    this.setState({ preset, ...patch });
  }

  syncUI() {
    [...this.root.querySelectorAll("[data-field]"), ...(this.backgroundRoot?.querySelectorAll("[data-field]") || [])]
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

    // Stage C0 §6：把 maxColors 的内部哨兵值 0 翻译成人话，并高亮当前档位。
    // 数字框仍然显示原始数字（0..221），读数与档位负责解释它。
    const capValue = Number(this.state.maxColors) || 0;
    const capReadout = this.root.querySelector("#ws-color-cap-readout");

    if (capReadout) {
      capReadout.textContent = capValue > 0
        ? `最多 ${capValue} 色`
        : "不限制（由算法按画面自行决定）";
    }

    this.root
      .querySelectorAll("[data-color-cap]")
      .forEach(button => {
        button.classList.toggle(
          "is-active",
          (Number(button.dataset.colorCap) || 0) === capValue
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
    if(advanced)advanced.hidden=!this.state.advancedOpen;
    this.root.querySelector('[data-action="toggle-advanced"]')?.setAttribute('aria-expanded',String(this.state.advancedOpen));

    if (advancedLabel) {
      advancedLabel.textContent =
        this.state.advancedOpen
          ? "收起"
          : "展开";
    }
  }
}
