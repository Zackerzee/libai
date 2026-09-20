import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const threadId = process.env.CODEX_THREAD_ID ?? "handmade_pricing";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");
const outputDir = path.join(projectRoot, "outputs", threadId);
const outputPath = path.join(outputDir, "手作成本定价计算表.xlsx");
const previewDir = path.join(outputDir, "previews");

const workbook = Workbook.create();
workbook.setColorScheme({
  name: "Handmade Pricing",
  themeColors: {
    accent1: "#2F5D62",
    accent2: "#C86B85",
    accent3: "#F2B84B",
    accent4: "#7A9E7E",
    dk1: "#1F2933",
    lt1: "#FFFFFF",
    lt2: "#F5F7F8",
    hlink: "#2563EB",
    folHlink: "#7C3AED",
  },
});

const inputFill = "#FFF2CC";
const outputFill = "#E6F4F1";
const headerFill = "#2F5D62";
const subHeaderFill = "#DDEBE9";
const pinkFill = "#F8E4EA";
const grayFill = "#F5F7F8";
const borderColor = "#D7DEE2";
const darkText = "#1F2933";
const goodFill = "#E2F0D9";

function setTitle(sheet, range, title, subtitle) {
  sheet.getRange(range.title).values = [[title]];
  sheet.getRange(range.title).merge();
  sheet.getRange(range.title).format = {
    fill: headerFill,
    font: { name: "Arial", size: 18, color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: headerFill },
  };
  sheet.getRange(range.subtitle).values = [[subtitle]];
  sheet.getRange(range.subtitle).merge();
  sheet.getRange(range.subtitle).format = {
    fill: subHeaderFill,
    font: { name: "Arial", size: 10, color: darkText },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: borderColor },
  };
}

function sectionHeader(sheet, range, title, fill = subHeaderFill) {
  sheet.getRange(range).values = [[title]];
  sheet.getRange(range).merge();
  sheet.getRange(range).format = {
    fill,
    font: { name: "Arial", size: 12, color: darkText, bold: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: borderColor },
  };
}

function applyTableStyle(sheet, range) {
  sheet.getRange(range).format = {
    font: { name: "Arial", size: 10, color: darkText },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: borderColor },
  };
}

function formatMoney(sheet, range) {
  sheet.getRange(range).format.numberFormat = '#,##0.00;[Red]-#,##0.00;"-"';
  sheet.getRange(range).format.horizontalAlignment = "right";
}

function formatPercent(sheet, range) {
  sheet.getRange(range).format.numberFormat = "0.0%";
  sheet.getRange(range).format.horizontalAlignment = "right";
}

const calc = workbook.worksheets.getOrAdd("定价计算器", { renameFirstIfOnlyNewSpreadsheet: true });
const bulk = workbook.worksheets.add("批量定价");
const params = workbook.worksheets.add("参数假设");
const guide = workbook.worksheets.add("成本说明");
const backend = workbook.worksheets.add("后台字段");

// 参数假设
setTitle(params, { title: "A1:F1", subtitle: "A2:F2" }, "手作定价参数假设", "这里维护默认时薪、平台扣点和成本建议区间；其他工作表会引用这些参数。");
params.getRange("A4:B8").values = [
  ["目标月收入", 6000],
  ["每月工作时长（小时）", 200],
  ["自动计算时薪", null],
  ["默认平台扣点", 0.05],
  ["默认目标净利润率", 0.34],
];
params.getRange("B6").formulas = [["=IFERROR(B4/B5,0)"]];
params.getRange("A10:B10").values = [["销售渠道", "默认扣点/摊位费率"]];
params.getRange("A11:B15").values = [
  ["小红书", 0.05],
  ["抖音", 0.05],
  ["微信/私域", 0],
  ["线下摊位", 0.1],
  ["其他", 0.05],
];
params.getRange("D4:F4").values = [["成本类型", "建议区间", "说明"]];
params.getRange("D5:F10").values = [
  ["材料成本", "40%-50%", "珠子、线材等主材，按批量采购和单件耗用量计算。"],
  ["工具成本", "2%-5%", "钳子、胶水等一次性工具，建议按预计件数摊销到单件。"],
  ["物流成本", "8%-20%", "快递和包装都要计入，低客单价商品尤其不能忽略。"],
  ["时间成本", "按时薪", "时薪 = 目标月收入 ÷ 每月工作时长；单件时间成本 = 时薪 × 制作时间。"],
  ["运营成本", "按渠道", "平台扣点或摊位费按售价比例扣除，不建议直接混入固定成本。"],
  ["目标利润", "20%-40%", "零售手作常见目标净利润率，可按品类、稀缺度和竞争调整。"],
];
applyTableStyle(params, "A4:B8");
applyTableStyle(params, "A10:B15");
applyTableStyle(params, "D4:F10");
params.getRange("A4:A8").format.fill = subHeaderFill;
params.getRange("A10:B10").format = {
  fill: headerFill,
  font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#FFFFFF" },
};
params.getRange("D4:F4").format = {
  fill: headerFill,
  font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#FFFFFF" },
};
formatMoney(params, "B4:B6");
formatPercent(params, "B7:B8");
formatPercent(params, "B11:B15");
params.getRange("A:A").format.columnWidthPx = 150;
params.getRange("B:B").format.columnWidthPx = 120;
params.getRange("D:D").format.columnWidthPx = 112;
params.getRange("E:E").format.columnWidthPx = 100;
params.getRange("F:F").format.columnWidthPx = 380;
params.getRange("A1:F1").format.rowHeightPx = 36;
params.getRange("A2:F2").format.rowHeightPx = 32;
params.getRange("D5:F10").format.rowHeightPx = 44;

// 单品定价计算器
setTitle(calc, { title: "A1:Q1", subtitle: "A2:Q2" }, "手作成本定价计算器", "黄色格可修改；建议售价会把平台扣点、目标利润率和时间成本一起纳入计算。");
sectionHeader(calc, "A4:C4", "基础输入", subHeaderFill);
sectionHeader(calc, "D4:E4", "定价结果", outputFill);
sectionHeader(calc, "F4:H4", "建议售价构成", pinkFill);
calc.getRange("A5:C19").values = [
  ["商品名称", "示例手链", "可改成具体款式"],
  ["主材成本（珠子/线材）", 40, "珠子、线材、配件等"],
  ["工具购置总额", 100, "钳子、胶水等一次性工具"],
  ["预计摊销件数", 100, "预计可服务多少件作品"],
  ["单件工具成本", null, "工具购置总额 ÷ 摊销件数"],
  ["快递费", 5.5, "单件承担的实际快递费"],
  ["包装费", 1.5, "盒子、卡纸、防震袋等"],
  ["制作时间（小时）", 1, "例如 45 分钟填 0.75"],
  ["目标月收入", null, "默认引用参数假设"],
  ["月工作时长（小时）", null, "默认 25 天 × 8 小时"],
  ["目标时薪", null, "目标月收入 ÷ 月工作时长"],
  ["平台扣点/摊位费率", 0.05, "小红书、抖音默认 5%"],
  ["目标净利润率", 0.34, "利润 ÷ 售价"],
  ["目标利润额（可选）", "", "填金额时优先按利润额定价"],
  ["其他单件成本", 0, "贴纸、损耗、赠品等"],
];
calc.getRange("B9").formulas = [["=IFERROR(B7/B8,0)"]];
calc.getRange("B13").formulas = [["='参数假设'!B4"]];
calc.getRange("B14").formulas = [["='参数假设'!B5"]];
calc.getRange("B15").formulas = [["=IFERROR(B13/B14,0)"]];
calc.getRange("D5:E16").values = [
  ["固定成本（不含平台扣点）", null],
  ["时间成本", null],
  ["平台扣点金额", null],
  ["目标利润额", null],
  ["保本售价", null],
  ["原始建议售价", null],
  ["建议售价", null],
  ["成交后净利润", null],
  ["实际净利润率", null],
  ["主材占固定成本", null],
  ["建议价/主材倍率", null],
  ["状态", null],
];
calc.getRange("E5:E16").formulas = [
  ["=SUM(B6,B9:B11,B12*B15,B19)"],
  ["=B12*B15"],
  ["=E11*B16"],
  ["=IF(B18>0,B18,E11*B17)"],
  ["=IFERROR(E5/(1-B16),0)"],
  ["=IF(B18>0,IFERROR((E5+B18)/(1-B16),0),IF(B16+B17>=1,0,IFERROR(E5/(1-B16-B17),0)))"],
  ["=ROUNDUP(E10,0)"],
  ["=E11-E5-E7"],
  ["=IFERROR(E12/E11,0)"],
  ["=IFERROR(B6/E5,0)"],
  ["=IFERROR(E11/B6,0)"],
  ["=IF(OR(B16+B17>=1,E10<=0),\"检查扣点/利润率\",IF(E13>=B17,\"可用\",\"偏低\"))"],
];
calc.getRange("F5:H13").values = [
  ["成本项", "金额", "占售价"],
  ["主材", null, null],
  ["工具摊销", null, null],
  ["快递", null, null],
  ["包装", null, null],
  ["时间", null, null],
  ["其他", null, null],
  ["平台扣点", null, null],
  ["净利润", null, null],
];
calc.getRange("G6:H13").formulas = [
  ["=B6", "=IFERROR(G6/$E$11,0)"],
  ["=B9", "=IFERROR(G7/$E$11,0)"],
  ["=B10", "=IFERROR(G8/$E$11,0)"],
  ["=B11", "=IFERROR(G9/$E$11,0)"],
  ["=E6", "=IFERROR(G10/$E$11,0)"],
  ["=B19", "=IFERROR(G11/$E$11,0)"],
  ["=E7", "=IFERROR(G12/$E$11,0)"],
  ["=E12", "=IFERROR(G13/$E$11,0)"],
];
calc.getRange("J4:Q4").values = [["快速判断", "", "", "", "", "", "", ""]];
calc.getRange("J4:Q4").merge();
calc.getRange("J5:Q10").values = [
  ["建议售价", null, "固定成本", null, "实际净利润率", null, "平台扣点", null],
  ["", null, "", null, "", null, "", null],
  ["保本售价", null, "净利润", null, "主材占比", null, "目标时薪", null],
  ["", null, "", null, "", null, "", null],
  ["定价公式", "利润率模式：固定成本 ÷ (1 - 平台扣点 - 目标净利润率)", "", "", "利润额模式：固定成本 + 目标利润额，再除以 (1 - 平台扣点)", "", "", ""],
  ["注意", "平台扣点按售价计算，不能简单把 5% 加到固定成本里。", "", "", "", "", "", ""],
];
calc.getRange("K9:N9").merge();
calc.getRange("O9:Q9").merge();
calc.getRange("K10:Q10").merge();
calc.getRange("K5").formulas = [["=E11"]];
calc.getRange("M5").formulas = [["=E5"]];
calc.getRange("O5").formulas = [["=E13"]];
calc.getRange("Q5").formulas = [["=B16"]];
calc.getRange("K7").formulas = [["=E9"]];
calc.getRange("M7").formulas = [["=E12"]];
calc.getRange("O7").formulas = [["=E14"]];
calc.getRange("Q7").formulas = [["=B15"]];
calc.getRange("J4:Q4").format = {
  fill: headerFill,
  font: { name: "Arial", size: 12, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: headerFill },
};
applyTableStyle(calc, "A5:C19");
applyTableStyle(calc, "D5:E16");
applyTableStyle(calc, "F5:H13");
applyTableStyle(calc, "J5:Q10");
calc.getRange("A5:A19").format.fill = subHeaderFill;
calc.getRange("B5:B8").format.fill = inputFill;
calc.getRange("B10:B12").format.fill = inputFill;
calc.getRange("B16:B19").format.fill = inputFill;
calc.getRange("E5:E16").format.fill = outputFill;
calc.getRange("F5:H5").format = {
  fill: headerFill,
  font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#FFFFFF" },
};
calc.getRange("J5:Q8").format.fill = grayFill;
calc.getRange("J9:Q10").format.fill = "#FFFFFF";
calc.getRange("K5").format = {
  fill: goodFill,
  font: { name: "Arial", size: 18, color: darkText, bold: true },
  horizontalAlignment: "right",
  numberFormat: '#,##0.00;[Red]-#,##0.00;"-"',
  borders: { preset: "all", style: "thin", color: borderColor },
};
formatMoney(calc, "B6:B11");
formatMoney(calc, "B13:B15");
formatMoney(calc, "B18:B19");
formatPercent(calc, "B16:B17");
formatMoney(calc, "E5:E12");
formatPercent(calc, "E13:E14");
calc.getRange("E15").format.numberFormat = "0.0x";
formatMoney(calc, "G6:G13");
formatPercent(calc, "H6:H13");
formatMoney(calc, "K5");
formatMoney(calc, "M5");
formatPercent(calc, "O5:Q5");
formatMoney(calc, "K7:M7");
formatPercent(calc, "O7");
formatMoney(calc, "Q7");
calc.getRange("A:A").format.columnWidthPx = 170;
calc.getRange("B:B").format.columnWidthPx = 120;
calc.getRange("C:C").format.columnWidthPx = 210;
calc.getRange("D:D").format.columnWidthPx = 175;
calc.getRange("E:E").format.columnWidthPx = 130;
calc.getRange("F:F").format.columnWidthPx = 100;
calc.getRange("G:H").format.columnWidthPx = 95;
calc.getRange("J:Q").format.columnWidthPx = 108;
calc.getRange("A1:Q1").format.rowHeightPx = 40;
calc.getRange("A2:Q2").format.rowHeightPx = 32;
calc.getRange("A4:Q4").format.rowHeightPx = 26;
calc.getRange("A5:Q19").format.rowHeightPx = 28;
calc.getRange("J9:Q10").format.rowHeightPx = 42;
const calcChart = calc.charts.add("bar", calc.getRange("F5:G13"));
calcChart.title = "建议售价构成";
calcChart.hasLegend = false;
calcChart.xAxis = { axisType: "textAxis" };
calcChart.yAxis = { numberFormatCode: "¥#,##0" };
calcChart.setPosition("J12", "Q28");

// 批量定价
setTitle(bulk, { title: "A1:U1", subtitle: "A2:U2" }, "批量售价定价表", "每一行录入一个款式；黄色列为主要输入，绿色列为自动输出。渠道会自动带出平台扣点。");
bulk.getRange("A3:U3").values = [[
  "产品/款式",
  "渠道",
  "主材成本",
  "工具摊销",
  "快递费",
  "包装费",
  "制作小时",
  "时薪",
  "时间成本",
  "其他成本",
  "固定成本",
  "平台扣点",
  "目标净利润率",
  "目标利润额",
  "原始建议价",
  "建议售价",
  "平台扣点金额",
  "净利润",
  "净利润率",
  "主材占固定成本",
  "定价状态",
]];
const bulkRows = Array.from({ length: 30 }, () => Array(21).fill(""));
const samples = [
  ["示例手链", "小红书", 40, 1, 5.5, 1.5, 1, 30, "", 0, "", "", 0.34, ""],
  ["低价发夹", "抖音", 12, 0.5, 5.5, 1, 0.4, 30, "", 0, "", "", 0.3, ""],
  ["复杂项链", "小红书", 68, 2, 7, 2, 2.5, 30, "", 0, "", "", 0.4, ""],
  ["线下摊位小物", "线下摊位", 20, 0.8, 0, 1, 0.6, 30, "", 0, "", "", 0.35, ""],
];
for (let i = 0; i < samples.length; i += 1) {
  const row = samples[i];
  for (let j = 0; j < row.length; j += 1) bulkRows[i][j] = row[j];
}
bulk.getRange("A4:U33").values = bulkRows;
const formulaRows = Array.from({ length: 30 }, (_, i) => i + 4);
bulk.getRange("I4:I33").formulas = formulaRows.map((r) => [`=IF($A${r}="","",$G${r}*$H${r})`]);
bulk.getRange("K4:K33").formulas = formulaRows.map((r) => [`=IF($A${r}="","",SUM($C${r}:$F${r},$I${r},$J${r}))`]);
bulk.getRange("L4:L33").formulas = formulaRows.map((r) => [`=IF($A${r}="","",IFERROR(VLOOKUP($B${r},'参数假设'!$A$11:$B$15,2,FALSE),'参数假设'!$B$7))`]);
bulk.getRange("O4:U33").formulas = formulaRows.map((r) => [
  `=IF($A${r}="","",IF($N${r}>0,IFERROR(($K${r}+$N${r})/(1-$L${r}),""),IF($L${r}+$M${r}>=1,"",IFERROR($K${r}/(1-$L${r}-$M${r}),""))))`,
  `=IF($O${r}="","",ROUNDUP($O${r},0))`,
  `=IF($A${r}="","",$P${r}*$L${r})`,
  `=IF($A${r}="","",$P${r}-$K${r}-$Q${r})`,
  `=IF($A${r}="","",IFERROR($R${r}/$P${r},""))`,
  `=IF($A${r}="","",IFERROR($C${r}/$K${r},""))`,
  `=IF($A${r}="","",IF($O${r}="","检查扣点/利润率",IF($S${r}>=$M${r},"达标","利润不足")))`,
]);
applyTableStyle(bulk, "A3:U33");
bulk.getRange("A3:U3").format = {
  fill: headerFill,
  font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#FFFFFF" },
};
bulk.getRange("A4:H33").format.fill = inputFill;
bulk.getRange("J4:J33").format.fill = inputFill;
bulk.getRange("M4:N33").format.fill = inputFill;
bulk.getRange("I4:I33").format.fill = "#FFFFFF";
bulk.getRange("K4:L33").format.fill = outputFill;
bulk.getRange("O4:U33").format.fill = outputFill;
bulk.getRange("A:A").format.columnWidthPx = 150;
bulk.getRange("B:B").format.columnWidthPx = 105;
bulk.getRange("C:F").format.columnWidthPx = 88;
bulk.getRange("G:H").format.columnWidthPx = 82;
bulk.getRange("I:U").format.columnWidthPx = 95;
bulk.getRange("U:U").format.columnWidthPx = 120;
bulk.getRange("A1:U1").format.rowHeightPx = 40;
bulk.getRange("A2:U2").format.rowHeightPx = 32;
bulk.getRange("A3:U33").format.rowHeightPx = 26;
bulk.getRange("B4:B33").dataValidation = { rule: { type: "list", values: ["小红书", "抖音", "微信/私域", "线下摊位", "其他"] } };
formatMoney(bulk, "C4:F33");
formatMoney(bulk, "H4:K33");
formatPercent(bulk, "L4:M33");
formatMoney(bulk, "N4:R33");
formatPercent(bulk, "S4:T33");
bulk.freezePanes.freezeRows(3);

// 成本说明
setTitle(guide, { title: "A1:F1", subtitle: "A2:F2" }, "手作成本定价说明表", "按你提供的成本口径整理，可作为团队培训或后台说明文档。");
guide.getRange("A4:F4").values = [["类别", "细分项目", "占比建议", "示例成本（元）", "计算备注", "省钱建议"]];
guide.getRange("A5:F13").values = [
  ["材料成本", "珠子、线材等", "40%-50%", 40, "根据批量采购价和单件耗用量计算", "大促采购；避免囤积冷门色；优先选择通用性材料"],
  ["工具成本", "钳子、胶水等", "2%-5%", 1, "按工具购置额 ÷ 预计制作件数摊销", "初期选择入门工具，确认销量后再升级"],
  ["物流成本", "快递", "5%-15%", 5.5, "按实际快递支出计算", "与网点或本地电商公司合作；使用寄件小程序比价"],
  ["物流成本", "包装", "3%-5%", 1.5, "盒子、卡纸、防震材料等", "不要过度包装；选择符合品牌定位的包装"],
  ["时间成本", "制作时间", "按时薪", 30, "目标时薪 × 制作时间", "优化流程；设置合理时薪，避免低估自己的时间价值"],
  ["运营成本", "平台扣点/摊位费", "常见 5%-10%", "5%", "按售价比例扣除，例如 100 元商品 5% 扣点为 5 元", "明确各平台扣点规则；初期可选择扣点较低渠道"],
  ["总成本", "固定成本合计", "-", 78, "主材 + 工具摊销 + 快递 + 包装 + 时间 + 其他，不含按售价扣的平台费", "固定成本越清楚，定价越稳定"],
  ["定价", "建议售价", "-", 128, "固定成本 ÷ (1 - 平台扣点 - 目标净利润率)", "也可按目标利润额定价"],
  ["销售利润", "净利润率", "-", "34%", "(售价 - 固定成本) ÷ 售价 - 平台扣点", "零售手作建议目标净利润率通常不低于 20%-40%"],
];
applyTableStyle(guide, "A4:F13");
guide.getRange("A4:F4").format = {
  fill: headerFill,
  font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#FFFFFF" },
};
guide.getRange("A5:A13").format.fill = subHeaderFill;
guide.getRange("D5:D13").format.horizontalAlignment = "right";
guide.getRange("A:A").format.columnWidthPx = 90;
guide.getRange("B:B").format.columnWidthPx = 130;
guide.getRange("C:C").format.columnWidthPx = 100;
guide.getRange("D:D").format.columnWidthPx = 110;
guide.getRange("E:E").format.columnWidthPx = 320;
guide.getRange("F:F").format.columnWidthPx = 320;
guide.getRange("A1:F1").format.rowHeightPx = 40;
guide.getRange("A2:F2").format.rowHeightPx = 32;
guide.getRange("A5:F13").format.rowHeightPx = 48;

// 后台字段设计
setTitle(backend, { title: "A1:G1", subtitle: "A2:G2" }, "后续后台管理字段设计", "这页把表格里的输入、输出和公式拆成后台程序可落库/计算的字段。");
backend.getRange("A4:G4").values = [["模块", "字段名", "中文名", "类型", "是否必填", "前端控件", "说明"]];
backend.getRange("A5:G27").values = [
  ["商品", "product_name", "产品/款式", "string", "是", "文本输入", "用于识别款式或 SKU"],
  ["商品", "channel", "销售渠道", "enum", "是", "下拉选择", "小红书、抖音、微信/私域、线下摊位、其他"],
  ["成本输入", "material_cost", "主材成本", "decimal", "是", "金额输入", "珠子、线材、配件等单件耗用成本"],
  ["成本输入", "tool_cost_per_item", "工具摊销", "decimal", "是", "金额输入", "工具购置额按预计件数摊销"],
  ["成本输入", "shipping_cost", "快递费", "decimal", "是", "金额输入", "单件承担的实际快递费"],
  ["成本输入", "packaging_cost", "包装费", "decimal", "是", "金额输入", "包装材料、卡纸、防震袋等"],
  ["成本输入", "labor_hours", "制作小时", "decimal", "是", "数字输入", "支持 0.5、0.75 等小数小时"],
  ["成本输入", "hourly_rate", "目标时薪", "decimal", "是", "金额输入", "目标月收入 ÷ 每月工作时长"],
  ["成本输入", "other_cost", "其他单件成本", "decimal", "否", "金额输入", "损耗、赠品、贴纸等"],
  ["策略输入", "platform_fee_rate", "平台扣点", "percent", "是", "百分比输入", "按销售渠道默认带出，可手动覆盖"],
  ["策略输入", "target_profit_margin", "目标净利润率", "percent", "否", "百分比输入", "利润率模式使用"],
  ["策略输入", "target_profit_amount", "目标利润额", "decimal", "否", "金额输入", "填了金额时优先使用利润额模式"],
  ["策略输入", "rounding_rule", "取整规则", "enum", "是", "下拉选择", "默认向上取整到整数元"],
  ["计算输出", "labor_cost", "时间成本", "decimal", "自动", "只读", "labor_hours × hourly_rate"],
  ["计算输出", "fixed_cost", "固定成本", "decimal", "自动", "只读", "不含平台扣点的单件成本"],
  ["计算输出", "break_even_price", "保本售价", "decimal", "自动", "只读", "fixed_cost ÷ (1 - platform_fee_rate)"],
  ["计算输出", "raw_suggested_price", "原始建议价", "decimal", "自动", "只读", "未取整的理论售价"],
  ["计算输出", "suggested_price", "建议售价", "decimal", "自动", "只读", "按取整规则处理后的售价"],
  ["计算输出", "platform_fee_amount", "平台扣点金额", "decimal", "自动", "只读", "suggested_price × platform_fee_rate"],
  ["计算输出", "net_profit_amount", "净利润", "decimal", "自动", "只读", "suggested_price - fixed_cost - platform_fee_amount"],
  ["计算输出", "net_profit_margin", "净利润率", "percent", "自动", "只读", "net_profit_amount ÷ suggested_price"],
  ["计算输出", "material_cost_share", "主材占比", "percent", "自动", "只读", "material_cost ÷ fixed_cost"],
  ["计算输出", "pricing_status", "定价状态", "enum", "自动", "标签", "达标、利润不足、检查扣点/利润率"],
];
backend.getRange("A30:G30").values = [["后台核心公式", "", "", "", "", "", ""]];
backend.getRange("A30:G30").merge();
backend.getRange("A31:G36").values = [
  ["fixedCost", "materialCost + toolCostPerItem + shippingCost + packagingCost + laborHours * hourlyRate + otherCost", "", "", "", "", ""],
  ["breakEvenPrice", "fixedCost / (1 - platformFeeRate)", "", "", "", "", ""],
  ["利润率模式", "rawPrice = fixedCost / (1 - platformFeeRate - targetProfitMargin)", "", "", "", "", ""],
  ["利润额模式", "rawPrice = (fixedCost + targetProfitAmount) / (1 - platformFeeRate)", "", "", "", "", ""],
  ["suggestedPrice", "ceil(rawPrice)", "", "", "", "", ""],
  ["netProfitMargin", "(suggestedPrice - fixedCost - suggestedPrice * platformFeeRate) / suggestedPrice", "", "", "", "", ""],
];
for (let r = 31; r <= 36; r += 1) {
  backend.getRange(`B${r}:G${r}`).merge();
}
applyTableStyle(backend, "A4:G27");
applyTableStyle(backend, "A31:G36");
backend.getRange("A4:G4").format = {
  fill: headerFill,
  font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#FFFFFF" },
};
backend.getRange("A30:G30").format = {
  fill: headerFill,
  font: { name: "Arial", size: 12, color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: headerFill },
};
backend.getRange("A5:A27").format.fill = subHeaderFill;
backend.getRange("A31:A36").format.fill = subHeaderFill;
backend.getRange("A:A").format.columnWidthPx = 92;
backend.getRange("B:B").format.columnWidthPx = 180;
backend.getRange("C:C").format.columnWidthPx = 120;
backend.getRange("D:F").format.columnWidthPx = 90;
backend.getRange("G:G").format.columnWidthPx = 330;
backend.getRange("A31:B36").format.columnWidthPx = 180;
backend.getRange("A1:G1").format.rowHeightPx = 40;
backend.getRange("A2:G2").format.rowHeightPx = 32;
backend.getRange("A5:G27").format.rowHeightPx = 28;
backend.getRange("A31:G36").format.rowHeightPx = 38;

await workbook.recalculate();

const calcCheck = await workbook.inspect({
  kind: "table",
  range: "定价计算器!A4:H16",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 10,
});
console.log(calcCheck.ndjson);

const bulkCheck = await workbook.inspect({
  kind: "table",
  range: "批量定价!A3:U8",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 21,
});
console.log(bulkCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(previewDir, { recursive: true });
const previewJobs = [
  ["定价计算器", "A1:Q28"],
  ["批量定价", "A1:U18"],
  ["参数假设", "A1:F15"],
  ["成本说明", "A1:F13"],
  ["后台字段", "A1:G36"],
];
for (const [sheetName, range] of previewJobs) {
  const blob = await workbook.render({ sheetName, range, format: "png", scale: 1 });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), Buffer.from(await blob.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`saved ${outputPath}`);
