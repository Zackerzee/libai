# 母版系统 V1：实现与验收记录

日期：2026-10-15。状态：主体已实现，**尚未达到完整验收通过**，未部署、未提交混合工作树。

## 审计依据

- 当前唯一豆格矩阵：`state/store.js` 的 `patternState.grid`；`state/project-store.js` 是适配器，不是第二份数据。
- 原工程打开：`app.js` 的 `LibmsWorkspaceBridge.loadProjectJson`，其行为就是替换文档。新入口另行解析为临时预览，不调用替换工程。
- 透明值：canonical grid 的 `null`。H01 仍是有身份的颜色，不把色号猜成透明。
- 原选区粘贴：`services/editor-service.js` 的 `pasteClipboard` 刻意包含空格，因此会擦除目标；保留原粘贴行为，新母版叠加明确跳过 null。
- 普通写入出口：`applyCellChanges`；批量/旧编辑器/生成还有整幅赋值路径，故增加 store 的保护预检。
- 复用 `createEditorCommand` / `createEditorService` 的唯一历史、现有 IndexedDB 手动版本数据库（独立母版 key，不升级原库）。

## 入口与使用

1. 顶栏「保存 → 保存当前作品 / 另存为母版」。
2. 顶栏「母版 → 我的母版 / 保存当前画布为母版 / 导入为图层（JSON）/ 锁定选区 / 解除锁定」。
3. 原「新建 / 导入」也提供「导入为图层（JSON）」；原打开工程行为不变。
4. 保存窗口提供名称、预览、尺寸、色卡、整个画布 / 选区 / 非透明像素 / 锁定区域四种范围。
5. 非透明模式不推断边框；锁定范围模式保持原画布尺寸，其余位置 null。
6. 同名时明确选择另存为新母版或更新指定 id。更新须确认，保留上一版；复制、重命名、删除、JSON 导出、恢复上一版都在库中。
7. 预览提供原坐标、居中、整数偏移，超出部分裁剪，不缩放。确认后一次事务应用；取消不写矩阵、不进历史。
8. 本地 IndexedDB 不是云备份。清理浏览器数据可能丢失母版，需定期导出 JSON。

## 数据契约 / 修改文件

新增：

- `services/template-service.mjs`：严格解析 libms-template v1、libms-project v1、legacy gridData；保存范围；透明叠加。
- `services/template-library.mjs`：IndexedDB 库、快照克隆、串行事务、跨标签 Web Locks、上一版、缓存 PNG 缩略图。
- `services/template-command.mjs`：不可变的豆格 + 保护掩码历史事务，包含真实 affectedCells，拒绝无变化操作。
- `ui/template-panel.mjs`、`styles/template-panel.css`：适配现有主题的紧凑弹窗和菜单。
- `tests/template-{service,library,locks,persistence,command}.test.mjs`、两份 104 格 JSON 示意夹具。

接入：

- `app.js`：isCellLocked / getTemplateLockMask / applyTemplateSnapshot；写入保护；JSON 可选锁定字段；新文档边界清空旧锁；锁定时不重新生成。生成算法未改。
- `state/store.js`：可选 `patternState.templateLockedMask`，不改变默认状态快照；整幅赋值保护；显式历史/工程快照必须先验证 mask。
- `services/editor-command.js`、`services/editor-service.js`：命令创建时排除锁定格、实时笔触保护、选区移动/变换原子拒绝、异常时保留撤销/重做栈。
- `services/auto-draft-service.js`、`services/project-version-service.js`：可选 mask 保存、校验、恢复。
- `ui/workspace.js`：入口、草稿/版本恢复、导出合成时保留锁定母版底格。现有 PNG/PDF 等导出算法不修改。
- `tests/international-roundtrip.test.mjs`：模拟 store 按真实 namespace/field 取值；增加 JSON mask 往返与损坏拒绝测试。

母版格式：`{format:'libms-template',version:1,name,width,height,paletteKey,grid}`；颜色保留 code、rgb、paletteId 与元数据，null 是透明。

工程仍为 libms-project v1，仅新增可选 `templateLockedMask:boolean[][]`。旧工程无此字段按无锁恢复。不同色卡或不能精确验证的色号拒绝，不做相近色替换。旧颜色缺少 paletteId，仅在色卡 key 相同且 code+RGB 唯一精确匹配时允许，仍保留原身份数据。

## 已执行验证

- 专项及扩展相关集合：111/111 通过，0 失败（日志 `/tmp/libms-template-focused-final.tap`；后续缩略图新增测试另有 9/9 通过）。
- 完整回归第二次运行：2629 项，2601 通过、27 失败、1 跳过，约 71.8 秒；日志 `/tmp/libms-template-full-final.tap`。
- 全套失败包括当前布局快照、palette VM fixture、deploy 源目录同步、菜单模拟、字体等，**未逐项完成干净基线归因，不能一概称为既有失败**。首次因新增 load 调用 cloneGrid 导致的 creator 测试失败已修复，专项重跑通过。
- 不更改失败断言来掩盖问题，不同步 deploy 以伪装源码发布已完成。

真实浏览器：本地 `http://127.0.0.1:8841/index.html`，窄屏默认约 376px、桌面 1440×900。

- 打开 104×104 示意边框，另存「海棠四格窗-验收」，原作品仍为 615 颗、尺寸不变。
- 打开另一张蓝色四景示意图，从库预览并应用母版；615 格边框叠加，透明区域保留蓝底，总颗数 7339。
- Cmd+Z：回到 6889 颗蓝底；Cmd+Shift+Z：回到 7339 颗，整次操作是一条历史。
- 导出母版 JSON 文件，再以纯服务解析；10,816 坐标的 code/RGB/身份/null 与预期逐格比较通过。
- 实际下载工程 JSON 含 615 个 true 锁定格，矩阵与叠加结果一致。
- 刷新并重新打开该工程，选择「仅保存锁定区域」，预览只剩边框，中间四格透明。
- 刷新后「我的母版」仍包含此前记录；真实填色点击已锁定中梃，颗数不变、没有新增撤销项。
- 页面已实际截图检查预览、母版库、锁定范围保存；未把旧 WorkBuddy 探针结果当作本次验收。
- 截图是示意四格边框与蓝底，不冒充真实海棠窗艺术图或城市风景素材。

## 性能与未完成门

Node 实测，不能替代浏览器主线程性能：

- 104×104 稀疏边框叠加：30 次 P50 7.75ms，P95 9.63ms，样本结束 heap 约 11.78MiB（非峰值）。
- 104×104 满目标单次 13.67ms；500×500 满目标单次 **251.05ms**，heap 约 48.54MiB（非峰值）。

500 格路径仍同步执行，存在明显 UI 阻塞风险，**性能门未通过**。需要把大尺寸预览/快照处理异步化并实测长任务，不能称为生产就绪。

其他限制：

- 当前母版保存的是 canonical 豆格底图，不把独立文字/二维码对象重新栅格化进去；避免悄悄改变原始矩阵。需在后续明确对象保存策略。
- 整幅旋转/翻转、改尺寸及重新生成在有锁时阻止并要求先解锁；未实现保护掩码跟随任意结构变换。
- 现有打开工程解析器保持原兼容行为；母版解析器单独做严格无损校验，尚未把二者彻底重构成共享解析层，以免改变旧项目导入语义。
- 还未逐一真实浏览器执行库的重命名/更新/上一版恢复/错误配额；这些目前仅单元测试覆盖。
- 未作新的独立 Git 提交。BASE / HEAD：`c54acef6b428b65f9753f0de330ff62647cfd1d2`；工作树 dirty，原有大量修改保留，未暂存或丢弃。

只有完整回归归因/修复、大尺寸性能门和剩余真实操作验收通过后，才可标记本任务全部完成。
