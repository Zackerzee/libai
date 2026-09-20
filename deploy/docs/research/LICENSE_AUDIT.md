# 六仓 License / 第三方审计

审计对象是各报告列出的**固定提交快照**，不是法律意见。授权结论以仓库实际文本为依据；无独立 LICENSE 时，README 或包元数据只能证明项目有 MIT 声明，**不能替代审过的完整许可条款**。本阶段没有复制第三方实现。

| 仓库 | 授权证据 | 商用/修改/再发布 | 署名/NOTICE | 源码公开义务 | 第三方关注点与处理 |
|---|---|---|---|---|---|
| A Pindou-Studio | [根 MIT LICENSE](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/LICENSE) | MIT 明文允许，须保留版权与许可声明 | 保留 LICENSE/copyright；未见根 NOTICE | MIT 本身无衍生源码公开要求 | 核对 `package.json`/锁文件依赖及色卡数据权利，不能由仓库 MIT 自动推及第三方数据 |
| B mard-bead-generator | [MIT LICENSE](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/LICENSE) | MIT 允许，附许可文本 | [THIRD_PARTY_NOTICES](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/THIRD_PARTY_NOTICES.md) 明列 `maxcleme/beadcolors` MIT 色卡及 `culori`/jsPDF/React 等 | MIT 本身无 | 色卡 MIT 通知需随使用方式保留；其“未复制 AGPL Zippland”只是仓库作者声明，不替代本项目独立归属核查 |
| C autoclaw-pixelbead-cli | [`package.json` license=MIT](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/package.json#L20-L27)、[README MIT](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/README.md#L124-L126)；快照未发现独立 LICENSE | **待核实完整条款/版权所有者后才可复制**；研究思想可继续 | 无根 NOTICE；Sharp 等依赖自有许可需单独核查 | 未能据此对复制义务作最终结论 | `sharp`、CLI/PDF 依赖与 palette 数据来源需逐一核对 |
| D PineBead-Studio | [README MIT 声明](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/README.md#L151-L154)；快照无独立 LICENSE，README 所谓“底部详情”在此快照未见完整 MIT 文本 | **不复制代码，先请求/查证完整许可** | 无根 NOTICE | 未确定 | Vue/Vite 自有许可，MARD 色值来源需核实 |
| E Perler_Beads_Generator | [根 MIT LICENSE](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/LICENSE) | MIT 允许，附许可文本 | 保留 LICENSE/copyright；未见根 NOTICE | MIT 本身无 | 色卡数据及 React/Vite 等三方条款需单独检查 |
| F kuizuo/pin-dou | 固定快照无根 LICENSE/NOTICE，`package.json` 无 license 字段 | **不能假设商用/修改/再发布授权；不复制代码** | 无可执行的仓库许可归属文本 | 未确定 | `color-diff`、Next/React、MARD 数据与云端服务各自核查；只抽象研究思想 |

跨仓注意：六仓中的算法**思想/数学描述**可独立研究，但具体代码表达、数据文件、图标和界面素材不能因为“可见”就默认可复制。A/B/E 若实际复用代码，需保留 MIT 版权/许可文本，并把被复制文件、版本和修改记录写入本项目第三方清单。C/D/F 在许可未补齐前 `DO NOT COPY CODE`。任何依赖转授权和色卡数据归属应另外审计，不把 GitHub 页面上的 License 标签当成完整凭据。

**G 补充**：[`zwhy149/bead-grid-studio` `515e180` 根 LICENSE](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/LICENSE) 为 Apache-2.0，并有 [NOTICE](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/NOTICE)。Apache-2.0 允许商用、修改和分发，但对再分发、版权/许可证/NOTICE 及修改说明有义务；无需把整个衍生作品按 Apache-2.0 开源。CURRENT 已有 [`bgs/NOTICE`](../../src/algorithms/bgs/NOTICE)、[Apache-2.0 文本](../../src/algorithms/bgs/LICENSE-APACHE-2.0.txt) 和修改记录，本轮不重复复制上游实现。G 的 MARD 数据来自第三方，不能由 G 代码许可证自动推定数据权利；CURRENT BGS 模块要求调用方提供色卡。
