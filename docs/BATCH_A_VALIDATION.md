# Batch A 验证与交接（2026-09-17）

来源需求：把 `GuoNH/perler-bead-manager` 与 `guqiao5757-png/doudou-up-beads` 两个开源项目的功能并入本生成器。
本批只做 A 批（图纸生成侧），库存管理为 B 批。根目录与 `deploy/` 已同步。

## 先做的差距核对

对照两个仓库逐项核对现状后，doudou UP 的 12 项里只有 5 项是真缺的，其余本站已具备且部分更强：
画笔/橡皮/吸管/油漆桶、撤销重做（Phase 3 已统一 100 步）、MARD 221 色、自定义画布尺寸、
滚轮缩放平移、采样方式（本站 5 档「格子采样」+ 结构细节保护，对方 2 档）。
因此本批不重做已有能力，只补真实缺口。

另需注意：本站的图纸 PNG 本来就带图例（`drawLegendPanel` 输出色块 + 色号 + 颗数），
所以对方宣传的「导出 JPG 带图例」在本站是格式变体，不是从零实现。

## 本批交付

| 能力 | 实现位置 | 说明 |
|---|---|---|
| 整幅 90° / 180° 旋转 | `services/editor-service.js` `rotateGrid()` + `rotate()` | 顺时针与逆时针各一档，进工具栏「更多」菜单 |
| 结构级撤销/重做 | 同上 `pushStructural()` / `pruneFor()` | 豆格级增量历史无法表达宽高变化，故改为整幅快照 |
| 参考底图描图 | `ui/canvas-renderer.js` reference 图层 + 编辑面板控件 | 垫在豆格层下方，空白处透出；适应/拉伸两种贴合、透明度、显示开关 |
| 导出 JPG | `app.js` `downloadPatternJpg()` | 复用 `PATTERN_EXPORT` preset，含表头与图例 |
| 导出 CSV 用量清单 | `app.js` `downloadUsageCsv()` | 色号、名称、HEX、RGB、颗数，带 BOM，Excel 可直接打开 |
| 工程存档 / 恢复 | `app.js` `buildProjectJson()` / `loadProjectJson()` | `format: "libms-project"`, `version: 1` |

新增桥接方法：`replaceGridStructure`、`renderExportPattern`、`downloadPatternJpg`、
`downloadUsageCsv`、`buildProjectJson`、`downloadProjectJson`、`loadProjectJson`。
`replaceGridStructure` 是旋转与工程恢复的共用出口，仍以 `state.grid` 为唯一事实源，
写入后走既有的 `refreshChartUrl()` + `updateResultUi()` + `libms:grid-edited` 链路。

## 明确的边界（不要对外宣称成已支持）

- **结构级操作会剔除旧宽高下的豆格级历史。** 90°/270° 交换宽高后，按旧宽高记录的
  豆格动作坐标不再可信，`pruneFor()` 会把它们从撤销/重做栈里移除；旋转本身（整幅快照）
  仍可撤销。180° 不换宽高，因此豆格历史保留。UI 在换宽高旋转前会先确认。
- **JPG 与 CSV 沿用与 PNG 相同的导出闸门**（Legacy 引擎下需先完成邀请注册）。
- **工程 JSON 只存色号与已用颜色信息**，不存原图；跨色卡打开时按存档颜色兜底，
  若色号在当前色卡与存档里都找不到则视为空豆。
- **底图不参与生成。** 它只是画布上的参考层，不会写进图纸、统计或导出。
- 未接入 PDF 或版本化工程文件之外的新格式；分板仍只走既有 ZIP。
- 导出色彩空间仍按浏览器 Canvas 默认，未加 ICC。

## 自动化测试

`node --test smart-preprocessing/*.test.mjs tests/ui-refactor-baseline/*.test.mjs`：**146/146 通过**
（本批前 137 项，新增 `tests/ui-refactor-baseline/batch-a-rotate-export.test.mjs` 9 项）。

新增用例覆盖：90°/180°/270° 的矩阵内容与宽高互换、四圈回到原状、输入矩阵不被就地修改、
旋转后一次撤销同时还原矩阵与宽高、换宽高的旋转剔除旧尺寸豆格历史而 180° 保留、
桥接层不支持时拒绝旋转、导出服务的能力探测与「请先生成图纸」闸门、底图默认状态。

## 浏览器端到端验证（2026-09-17）

无头 Chrome（本机 Google Chrome + CDP）实跑，源图 160×90，走生成面板输入设为 120×70 画布：

- 生成 120×70 / 10 色 / 8,400 颗。
- 顺时针 90° 后为 70×120，豆数与颜色数守恒（8,400 颗 / 10 色）——宽高互换确实生效。
- 撤销后回到 120×70。
- 底图层已创建，采样到非透明像素；图层顺序 `reference < base < grid < codes < overlay`，
  即底图确实在豆格层之下。透明度控件与界面同步。
- 导出抽屉 6 个格式全部可用；JPG 为真实 JPEG 字节（8.0 MB，头 `FF D8`）；
  CSV 12 行 = 表头 + 10 色 + 合计；工程 JSON 结构与矩阵完整。
- 工程 JSON 回灌后矩阵逐格一致（70×120 / 8,400 颗）。

15/16 项通过。唯一未通过项为**既有问题，非本批引入**：
`cdn.jsdelivr.net/npm/nsfwjs@4.2.1/dist/nsfwjs.min.js` 返回 404（content-type `text/plain`），
导致本地图片审查模型长期静默跳过。`app.js:44` 该常量与改动前的 `deploy/app.js:44` 逐字节相同，
确认为原有缺陷，本批未改动。nsfwjs 4.x 已把浏览器包移到 `dist/browser/nsfwjs.min.js`（该地址返回 200）。

截图证据（1600×1000，无头 Chrome 实跑）：

- `docs/evidence/batch-a/toolbar-rotate-and-reference.png`：工具栏「更多」菜单中的
  逆时针 90° / 顺时针 90°，以及右侧编辑面板的参考底图描图控件。
- `docs/evidence/batch-a/export-drawer-new-formats.png`：导出抽屉六个格式与「载入工程存档…」入口；
  画布上可见半透明底图垫在豆格之下。

## 已知未复测项

- 未复测旧画板弹窗（Legacy 编辑器）与工作台历史混用场景下的旋转交互。
- 未测超大画布（接近 500 上限）旋转后的绘制耗时；Canvas 层未做性能采样。
- 未测移动端窄屏下新增导出抽屉按钮与底图控件的换行表现。
- 未检查 JPG/CSV 实际落盘文件的字节，仅检查了交给下载器的 Blob 内容。
