# 工作台浏览器层验收（2026-10-14，Phase 3 截图验收）

真实 Chromium 驱动本地开发站（127.0.0.1:8813），完整走一遍
上传 → 自动生成 → 编辑 → 保存 → 导出。全程截图与产物在本目录。

环境：agent-browser CLI + 系统 Google Chrome（Chromium 下载超时后的替代路径，
`AGENT_BROWSER_EXECUTABLE_PATH` 指向 /Applications/Google Chrome.app）。
输入素材：`assets/brand/shiliber-mark-256.png`（已校准的真 Logo，256px）。

## 流程记录

| 步骤 | 截图 | 结果 |
|---|---|---|
| 1 首页 | 01-homepage.png | 上传入口正常 |
| 2 上传 + 自动生成 | 06-source-loaded.png | 源图注册（hasSource=true）→ 智能模式自动生成。底栏规格行：**MARD Standard 221 · 41 种颜色 · 10816 颗拼豆 · 104×104 图纸尺寸 · 27.0×27.0 cm 实物尺寸** |
| 3 编辑 | 07-edited.png | 选 F03 + 画笔点 3 处 → 状态变「已手动编辑」，F03 1272→1273 颗，总颗数 10816 不变（覆盖既有格，正确） |
| 4 保存 | 11-save-tab-open.png | 「保存工程」Tab → Pixler 工程下载 **saved-project.pixler**（4192 B） |
| 5 导出 | 12-export-preview.png | 「导出图纸」Tab → PNG 图纸下载 **exported-pattern.png**（1.85 MB） |

## 一致性对账（保存文件 vs 屏幕状态）

用应用自己的 `importPixlerProject` 解码下载的 .pixler：

| 项 | 屏幕 | 保存文件解码 | 结论 |
|---|---:|---:|:---:|
| 尺寸 | 104×104 | 104×104 | 一致 |
| 色数 | 41 | 41 | 一致 |
| 总颗数 | 10816 | 10816 | 一致 |
| F03 颗数 | 1273（含手绘 1 格） | 1273 | **一致——手编辑被完整带回** |
| 颜色身份条目 | — | 41 条（无塌并） | 一致 |

导出 PNG：5184×5506 px，与导出对话框预估完全一致；内容为完整施工图
（四环图案 + 网格 + 坐标标尺 + 顶部色卡图例）。

## 结论

编辑 → 保存 → 导出链路在真实浏览器中闭环一致，paletteId 身份修复后的
生产网格在 .pixler 往返中零丢失。截图与产物（含可复验的 .pixler 与 PNG）
均在本目录，可用 `importPixlerProject` 复验。

## 边界

- 单素材单次流程，是链路正确性证据，不是压力/兼容性测试。
- 保存文件的 brand 字段为 unknown：生产网格按既有契约只带 {code,rgb,hex}
  不带 paletteId（见 services/current-palette.mjs 的说明），属预期行为。
- 未提交、未同步 deploy、未上线。
