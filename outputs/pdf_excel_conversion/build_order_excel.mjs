import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("outputs");
const outputPath = path.join(outputDir, "百塑融合豆配件客户下单文件3.12(3).xlsx");
const imageDir = path.resolve("outputs/pdf_excel_conversion/embedded_images");
const imageWidthPx = 120;
const imageHeightPx = 82;

const topGroups = [
  [
    ["2.6mm异形板", "", "D2602-H01", "2.6透明大圆板", "", ""],
    ["2.6mm异形板", "", "D2602-H02", "2.6白色大圆板", "", ""],
    ["2.6mm异形板", "", "D2603-H01", "2.6透明大六边板", "", ""],
    ["2.6mm异形板", "", "D2603-H02", "2.6白色大六边板", "", ""],
    ["52画线", "", "D52-TH01", "52*52钉透明画黑线板", "", ""],
    ["52画线", "", "D52-HH02", "52*52钉白色画线板", "", ""],
    ["52画线", "", "D52-HH07", "52*52钉黑色画白线板", "", ""],
    ["52画线", "", "D52-HG15B", "52*52钉浅黄画蓝色板", "", ""],
    ["52画线", "", "D52-HG15O", "52*52钉浅黄画橙色板", "", ""],
    ["52画线", "", "D52-HC13W", "52*52钉蓝色画白线板", "", ""],
    ["52画线", "", "D52-HD08", "52*52钉紫色画白线板", "", ""],
    ["52画线", "", "D52-HF09", "52*52钉粉色画白线板", "", ""],
    ["104钉画线", "", "D104-HH02", "104*104钉白色画线板", "", ""],
  ],
  [
    ["50钉板", "", "D50-TH01", "50*50钉透明大方", "", ""],
    ["50钉板", "", "D50-QP01", "50*50钉棋盘格", "", ""],
    ["50钉板", "", "D50-TH02", "50*50钉白色大方", "", ""],
    ["50钉板", "", "D50-TH01", "50*50钉透明刻线板", "", ""],
    ["52棋盘格", "", "D52-QP01", "52*52钉棋盘格", "", ""],
    ["78画线", "", "D78-HH02", "78*78钉白色画线板", "", ""],
    ["78画线", "", "D78-HG15B", "78*78钉浅黄画蓝色线板", "", ""],
    ["78画线", "", "D78-HG15O", "78*78钉浅黄画橙色线板", "", ""],
    ["78画线", "", "D78-HC13W", "78*78钉蓝色画白色线板", "", ""],
    ["78画线", "", "D78-HG15W", "78*78钉浅黄画白色线板", "", ""],
    ["78画线", "", "D78-HH07", "78*78钉黑色画白色线板", "", ""],
    ["78画线", "", "D78-HH02P", "78*78钉白色画粉色线板", "", ""],
    ["104钉刻线", "", "D104-KH02", "104*104钉白色刻线板", "", ""],
  ],
  [
    ["52钉刻线板", "", "D52-KH02", "52*52钉刻线白", "", ""],
    ["52钉刻线板", "", "D52-KB20", "52*52钉刻线绿", "", ""],
    ["52钉刻线板", "", "D52-KD08", "52*52钉刻线紫", "", ""],
    ["52钉刻线板", "", "D52-KC13", "52*52钉刻线蓝", "", ""],
    ["52钉刻线板", "", "D52-KE18", "52*52钉刻线粉", "", ""],
    ["52钉刻线板", "", "D52-KA17", "52*52钉刻线黄", "", ""],
    ["52钉刻线板", "", "D52-KG15", "52*52钉刻线奶黄", "", ""],
    ["78钉刻线", "", "D78-KH02", "78*78钉白色刻线板", "", ""],
    ["100钉刻线", "", "D100-KH02", "100*100钉白色刻线板", "", ""],
    ["100钉画线", "", "D100-HH02", "100*100钉白色画线板", "", ""],
    ["100钉棋盘格", "", "D100-QP01", "100*100钉棋盘格板", "", "500个起订"],
  ],
];

const bottomGroups = [
  [
    ["立豆盘豆铲套装", "", "DC-01", "立豆盘豆铲套装-薄荷绿", "", ""],
    ["立豆盘豆铲套装", "", "DC-02", "立豆盘豆铲套装-云涧绿", "", ""],
    ["立豆盘豆铲套装", "", "DC-03", "立豆盘豆铲套装-天湖蓝", "", ""],
    ["立豆盘豆铲套装", "", "DC-04", "立豆盘豆铲套装-柠檬黄", "", ""],
    ["立豆盘豆铲套装", "", "DC-05", "立豆盘豆铲套装-薰草紫", "", ""],
    ["立豆盘豆铲套装", "", "DC-06", "立豆盘豆铲套装-桃雾粉", "", ""],
    ["烫画机", "", "C03", "方形烫画机", "", ""],
    ["烫画机", "", "LYK-01", "大型自动烫画机", "", ""],
    ["烫纸", "", "TZ-01", "18*20cm小烫纸", "", ""],
    ["烫纸", "", "TZ-02", "30*40cm大烫纸", "", ""],
    ["5mm拼豆配件", "", "D501", "5MM透明大方板", "", ""],
    ["5mm拼豆配件", "", "D502", "5MM透明圆板", "", ""],
    ["5mm拼豆配件", "", "D503", "5MM透明六边板", "", ""],
    ["5mm拼豆配件", "", "D504", "5MM透明六角星板", "", ""],
    ["5mm拼豆配件", "", "D501-W", "5MM白色大方", "", ""],
    ["5mm拼豆配件", "", "SN-001", "白色塑料镊子", "", ""],
  ],
  [
    ["立豆盒", "", "DH-01", "立豆盒-粉色", "", ""],
    ["立豆盒", "", "DH-02", "立豆盒-紫色", "", ""],
    ["立豆盒", "", "DH-03", "立豆盒-蓝色", "", ""],
    ["立豆盒", "", "DH-04", "立豆盒-白色", "", ""],
    ["立豆盒", "", "DH-05", "立豆盒-透明", "", ""],
    ["立豆盒", "", "DH-06", "立豆盒-绿色", "", ""],
    ["镊子", "", "NZ-01", "Diyfashion金属镊子", "", ""],
    ["其余配件", "", "CT01", "圆形橡胶磁铁", "", ""],
    ["其余配件", "", "SQ-01", "塑料龙虾扣", "", ""],
    ["其余配件", "", "YQ-07", "金属钥匙圈", "", ""],
    ["其余配件", "", "ZL-01", "金属珠链", "", ""],
    ["其余配件", "", "SL-21", "手机绳龙虾扣", "", ""],
    ["其余配件", "", "KL01", "开口圈", "", ""],
    ["其余配件", "", "HJ-11", "175*160cm 6层大货架", "", "黑 白两色任选 请备注"],
    ["其余配件", "", "FG-05", "5.5cm 透明小方盒", "", "1000个起批"],
    ["其余配件", "", "SNH-01", "24格收纳盒（尺寸19.5*13*3.5cm)", "", ""],
    ["其余配件", "", "ST01", "ibeads 302色色贴", "", ""],
  ],
  [
    ["双针豆笔", "", "DB-YJ01", "双针豆笔-云涧绿爱心款", "", ""],
    ["双针豆笔", "", "DB-YJ02", "双针豆笔-云涧绿星星款", "", ""],
    ["双针豆笔", "", "DB-BH01", "双针豆笔-薄荷绿爱心款", "", ""],
    ["双针豆笔", "", "DB-BH02", "双针豆笔-薄荷绿星星款", "", ""],
    ["双针豆笔", "", "DB-TW01", "双针豆笔-桃雾粉爱心款", "", ""],
    ["双针豆笔", "", "DB-TW02", "双针豆笔-桃雾粉星星款", "", ""],
    ["双针豆笔", "", "DB-LM01", "双针豆笔-柠檬黄爱心款", "", ""],
    ["双针豆笔", "", "DB-LM02", "双针豆笔-柠檬黄星星款", "", ""],
    ["双针豆笔", "", "DB-XY01", "双针豆笔-薰草紫爱心款", "", ""],
    ["双针豆笔", "", "DB-XY02", "双针豆笔-薰草紫星星款", "", ""],
    ["双针豆笔", "", "DB-TH01", "双针豆笔-天湖蓝爱心款", "", ""],
    ["双针豆笔", "", "DB-TH02", "双针豆笔-天湖蓝星星款", "", ""],
    ["双针豆笔", "", "DB-NY01", "双针豆笔-奶油橘爱心款", "", ""],
    ["双针豆笔", "", "DB-NY02", "双针豆笔-奶油橘星星款", "", ""],
  ],
];

const workbook = Workbook.create();
workbook.setColorScheme({
  name: "Order Form",
  themeColors: {
    accent1: "#1F4E79",
    accent2: "#70AD47",
    accent3: "#FFC000",
    dk1: "#1F2933",
    lt1: "#FFFFFF",
    lt2: "#EAF2F8",
    hlink: "#2563EB",
    folHlink: "#7C3AED",
  },
});

const orderSheet = workbook.worksheets.getOrAdd("下单表", { renameFirstIfOnlyNewSpreadsheet: true });
const detailSheet = workbook.worksheets.add("商品明细");

const headers = ["类目", "图片", "货号", "品名", "数量", "备注"];
const allRecords = [...topGroups.flat(), ...bottomGroups.flat()];
const productImageFiles = (await fs.readdir(imageDir))
  .filter((name) => /^product_\d+\.png$/i.test(name))
  .sort()
  .map((name) => path.join(imageDir, name));

if (productImageFiles.length !== allRecords.length) {
  throw new Error(`Expected ${allRecords.length} product images, found ${productImageFiles.length}`);
}

const productImagesByKey = new Map();
let nextImageIndex = 0;

function rangeFor(row, col, rows = 1, cols = 1) {
  return workbook.utils.toA1String(row, col, row + rows - 1, col + cols - 1);
}

function productKey(row) {
  return `${row[2]}|${row[3]}`;
}

async function imageDataUrl(file) {
  const data = await fs.readFile(file);
  return `data:image/png;base64,${data.toString("base64")}`;
}

function assignProductImages(groups) {
  const maxRows = Math.max(...groups.map((group) => group.length));
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    for (const group of groups) {
      const row = group[rowIndex];
      if (!row) continue;
      productImagesByKey.set(productKey(row), productImageFiles[nextImageIndex]);
      nextImageIndex += 1;
    }
  }
}

async function addImage(sheet, file, rowOneBased, colOneBased) {
  const dataUrl = await imageDataUrl(file);
  sheet.images.add({
    dataUrl,
    anchor: {
      from: {
        row: rowOneBased - 1,
        col: colOneBased - 1,
        rowOffsetPx: 4,
        colOffsetPx: 4,
      },
      extent: { widthPx: imageWidthPx, heightPx: imageHeightPx },
    },
  });
}

function writeBlock(sheet, startRow, groups) {
  for (let groupIndex = 0; groupIndex < 3; groupIndex += 1) {
    const startCol = groupIndex * 6 + 1;
    sheet.getRange(rangeFor(startRow, startCol, 1, 6)).values = [headers];
    sheet.getRange(rangeFor(startRow, startCol, 1, 6)).format = {
      fill: "accent1",
      font: { name: "Arial", size: 10, color: "lt1", bold: true },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      borders: { preset: "all", style: "thin", color: "#FFFFFF" },
    };

    const rows = groups[groupIndex];
    sheet.getRange(rangeFor(startRow + 1, startCol, rows.length, 6)).values = rows;
    sheet.getRange(rangeFor(startRow + 1, startCol, rows.length, 6)).format = {
      font: { name: "Arial", size: 9, color: "tx1" },
      verticalAlignment: "center",
      wrapText: true,
      borders: { preset: "all", style: "thin", color: "#D9E2EC" },
    };
    sheet.getRange(rangeFor(startRow + 1, startCol + 4, rows.length, 1)).format = {
      fill: "#FFF2CC",
      font: { name: "Arial", size: 9, color: "tx1" },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      borders: { preset: "all", style: "thin", color: "#D9E2EC" },
      numberFormat: "0",
    };
  }
}

async function addOrderImages(sheet, startRow, groups) {
  for (let groupIndex = 0; groupIndex < 3; groupIndex += 1) {
    const imageCol = groupIndex * 6 + 2;
    const rows = groups[groupIndex];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      await addImage(sheet, productImagesByKey.get(productKey(rows[rowIndex])), startRow + 1 + rowIndex, imageCol);
    }
  }
}

async function addDetailImages(sheet) {
  for (let i = 0; i < allRecords.length; i += 1) {
    await addImage(sheet, productImagesByKey.get(productKey(allRecords[i])), i + 2, 2);
  }
}

assignProductImages(topGroups);
assignProductImages(bottomGroups);

orderSheet.getRange("A1:R3").values = [
  [
    "采购日期：",
    "这里填订货日期",
    "采购总计（pcs）",
    "",
    "",
    "",
    "收货信息",
    "请填写收货人 / 电话 / 地址",
    "",
    "注意：采购日期、客户信息黄色背景处为必填；数量处填你需要的数量，只填数字。",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "板子建议填对应装箱数的倍数。",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
  [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "2.6mm 拼豆板装箱数据：50/50钉：260个一箱；78钉70个一箱；100/104钉45个一箱。",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ],
];
orderSheet.getRange("D1").formulas = [["=SUM(E:E,K:K,Q:Q)"]];
orderSheet.getRange("A1:R3").format = {
  font: { name: "Arial", size: 10, color: "tx1" },
  verticalAlignment: "center",
  wrapText: true,
};
orderSheet.getRange("B1").format.fill = "#FFF2CC";
orderSheet.getRange("H1:I3").format.fill = "#FFF2CC";
orderSheet.getRange("D1").format = {
  fill: "#E2F0D9",
  font: { name: "Arial", size: 11, color: "tx1", bold: true },
  horizontalAlignment: "center",
  numberFormat: "0",
  borders: { preset: "outside", style: "thin", color: "#A9D18E" },
};
orderSheet.getRange("A1:R3").format.borders = { preset: "outside", style: "thin", color: "#B7C9D6" };

writeBlock(orderSheet, 5, topGroups);
writeBlock(orderSheet, 20, bottomGroups);
await addOrderImages(orderSheet, 5, topGroups);
await addOrderImages(orderSheet, 20, bottomGroups);

orderSheet.getRange("A1:R38").format.verticalAlignment = "center";
orderSheet.getRange("A1:R38").format.wrapText = true;
orderSheet.getRange("B:B").format.columnWidthPx = 128;
orderSheet.getRange("H:H").format.columnWidthPx = 128;
orderSheet.getRange("N:N").format.columnWidthPx = 128;
orderSheet.getRange("A:A").format.columnWidthPx = 112;
orderSheet.getRange("C:C").format.columnWidthPx = 116;
orderSheet.getRange("D:D").format.columnWidthPx = 178;
orderSheet.getRange("E:E").format.columnWidthPx = 46;
orderSheet.getRange("F:F").format.columnWidthPx = 96;
orderSheet.getRange("G:G").format.columnWidthPx = 112;
orderSheet.getRange("I:I").format.columnWidthPx = 116;
orderSheet.getRange("J:J").format.columnWidthPx = 242;
orderSheet.getRange("K:K").format.columnWidthPx = 46;
orderSheet.getRange("L:L").format.columnWidthPx = 120;
orderSheet.getRange("M:M").format.columnWidthPx = 112;
orderSheet.getRange("O:O").format.columnWidthPx = 116;
orderSheet.getRange("P:P").format.columnWidthPx = 200;
orderSheet.getRange("Q:Q").format.columnWidthPx = 46;
orderSheet.getRange("R:R").format.columnWidthPx = 120;
orderSheet.getRange("A6:R18").format.rowHeightPx = 90;
orderSheet.getRange("A21:R37").format.rowHeightPx = 90;
orderSheet.getRange("A1:R3").format.rowHeightPx = 28;
orderSheet.getRange("A5:R5").format.rowHeightPx = 26;
orderSheet.getRange("A20:R20").format.rowHeightPx = 26;

detailSheet.getRange("A1:F1").values = [headers];
detailSheet.getRange(`A2:F${allRecords.length + 1}`).values = allRecords;
await addDetailImages(detailSheet);
detailSheet.getRange("H1:I2").values = [
  ["采购总计（pcs）", ""],
  ["来源文件", "百塑融合豆配件客户下单文件3.12(3).pdf"],
];
detailSheet.getRange("I1").formulas = [[`=SUM(E2:E${allRecords.length + 1})`]];
detailSheet.getRange("A1:F1").format = {
  fill: "accent1",
  font: { name: "Arial", size: 10, color: "lt1", bold: true },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: "#FFFFFF" },
};
detailSheet.getRange(`A2:F${allRecords.length + 1}`).format = {
  font: { name: "Arial", size: 10, color: "tx1" },
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "all", style: "thin", color: "#D9E2EC" },
};
detailSheet.getRange(`E2:E${allRecords.length + 1}`).format = {
  fill: "#FFF2CC",
  font: { name: "Arial", size: 10, color: "tx1" },
  horizontalAlignment: "center",
  numberFormat: "0",
  borders: { preset: "all", style: "thin", color: "#D9E2EC" },
};
detailSheet.getRange("H1:I2").format = {
  font: { name: "Arial", size: 10, color: "tx1" },
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "all", style: "thin", color: "#D9E2EC" },
};
detailSheet.getRange("H1").format.fill = "#E2F0D9";
detailSheet.getRange("I1").format = {
  fill: "#E2F0D9",
  font: { name: "Arial", size: 10, color: "tx1", bold: true },
  numberFormat: "0",
  horizontalAlignment: "center",
};
detailSheet.getRange("A:A").format.columnWidthPx = 128;
detailSheet.getRange("B:B").format.columnWidthPx = 128;
detailSheet.getRange("C:C").format.columnWidthPx = 116;
detailSheet.getRange("D:D").format.columnWidthPx = 230;
detailSheet.getRange("E:E").format.columnWidthPx = 54;
detailSheet.getRange("F:F").format.columnWidthPx = 170;
detailSheet.getRange("H:H").format.columnWidthPx = 128;
detailSheet.getRange("I:I").format.columnWidthPx = 260;
detailSheet.getRange(`A2:I${allRecords.length + 1}`).format.rowHeightPx = 90;
detailSheet.getRange("A1:I1").format.rowHeightPx = 26;

await workbook.recalculate();

const previewOrder = await workbook.inspect({
  kind: "table",
  range: "下单表!A1:R10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 18,
});
console.log(previewOrder.ndjson);

const previewDetail = await workbook.inspect({
  kind: "table",
  range: "商品明细!A1:F12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 6,
});
console.log(previewDetail.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const orderPreview = await workbook.render({ sheetName: "下单表", range: "A1:R38", format: "png", scale: 1 });
await fs.writeFile(path.join(outputDir, "下单表预览.png"), Buffer.from(await orderPreview.arrayBuffer()));
const detailPreview = await workbook.render({ sheetName: "商品明细", range: `A1:I${allRecords.length + 1}`, format: "png", scale: 1 });
await fs.writeFile(path.join(outputDir, "商品明细预览.png"), Buffer.from(await detailPreview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`saved ${outputPath}`);
