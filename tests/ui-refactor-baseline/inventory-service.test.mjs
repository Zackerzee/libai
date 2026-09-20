import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventoryService, parseCsv, normalizeCode, CSV_HEADERS } from "../../services/inventory-service.js";

/** 内存 storage 适配器：单测不碰 localStorage。 */
function memoryStorage(seed = null) {
  const map = new Map();
  if (seed) map.set("libms-inventory-v1", JSON.stringify(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    dump: () => JSON.parse(map.get("libms-inventory-v1") || "null"),
  };
}

const PALETTE = [
  { code: "H07", name: "白色", hex: "#FFFFFF", rgb: [255, 255, 255] },
  { code: "A11", name: "正红", hex: "#D0021B", rgb: [208, 2, 27] },
  { code: "B03", name: "天蓝", hex: "#4A90D9", rgb: [74, 144, 217] },
];

function makeService(options = {}) {
  const storage = options.storage || memoryStorage();
  let stats = options.stats || [];
  const service = createInventoryService({
    storage,
    getPaletteColors: () => PALETTE,
    getStats: () => stats,
    idFactory: (() => { let n = 0; return () => `sub-${++n}`; })(),
    now: (() => { let n = 0; return () => `2026-09-17T00:00:${String(n++).padStart(2, "0")}Z`; })(),
  });
  return { service, storage, setStats: (next) => { stats = next; } };
}

test("normalizeCode 去空白并大写", () => {
  assert.equal(normalizeCode(" h07 "), "H07");
  assert.equal(normalizeCode(null), "");
});

test("upsertItem 会从色卡补齐名称与颜色", () => {
  const { service } = makeService();
  service.upsertItem("h07", { stock: 100, minStock: 20 });
  const item = service.getItem("H07");
  assert.equal(item.name, "白色");
  assert.equal(item.hex, "#FFFFFF");
  assert.deepEqual(item.rgb, [255, 255, 255]);
  assert.equal(item.stock, 100);
  assert.equal(item.unit, "颗");
});

test("upsertItem 拒绝非法库存", () => {
  const { service } = makeService();
  assert.throws(() => service.upsertItem("A11", { stock: -1 }), /非负整数/);
  assert.throws(() => service.upsertItem("A11", { minStock: "abc" }), /非负整数/);
  assert.throws(() => service.upsertItem("   ", { stock: 1 }), /不能为空/);
});

test("previewFromPattern 直读图纸统计，并标出缺料与未建档色号", () => {
  const { service, setStats } = makeService({ stats: [
    { code: "H07", name: "白色", hex: "#FFFFFF", count: 300 },
    { code: "A11", name: "正红", hex: "#D0021B", count: 50 },
  ] });
  service.upsertItem("H07", { stock: 100, minStock: 20 });
  const preview = service.previewFromPattern();
  assert.equal(preview.totalBeads, 350);
  assert.deepEqual(preview.missingCodes, ["A11"]);
  // A11 台账里没有 → 按 0 库存算，50 颗需求同样构成缺料，所以两个清单都会出现它。
  assert.deepEqual(preview.shortageCodes, ["H07", "A11"]);
  const white = preview.lines.find((line) => line.code === "H07");
  assert.equal(white.after, -200);
  assert.equal(white.enough, false);
  setStats([]);
  assert.equal(service.previewFromPattern().totalBeads, 0);
});

test("consume 真正扣减库存并写流水，未建档色号以 0 库存新建", () => {
  const { service } = makeService();
  service.upsertItem("H07", { stock: 100, minStock: 20 });
  const result = service.consume({ lines: [{ code: "H07", count: 30 }, { code: "B03", count: 10 }], source: "pattern", label: "图纸 A" });
  assert.equal(service.getItem("H07").stock, 70);
  assert.equal(service.getItem("B03").stock, -10);
  assert.deepEqual(result.created, ["B03"]);
  assert.deepEqual(result.shortages, [{ code: "B03", after: -10 }]);
  assert.equal(result.submission.lines.length, 2);
  assert.equal(result.submission.revertedAt, null);
  assert.equal(service.getOverview().totalStock, 70 + -10);
});

test("revert 回补库存，并把该次提交从累计消耗中排除", () => {
  const { service } = makeService();
  service.upsertItem("H07", { stock: 100, minStock: 20 });
  const first = service.consume({ lines: [{ code: "H07", count: 30 }], source: "pattern" });
  service.consume({ lines: [{ code: "H07", count: 5 }], source: "pattern" });
  assert.equal(service.getItem("H07").stock, 65);
  assert.equal(service.listItems().find((item) => item.code === "H07").consumed, 35);

  service.revert(first.submission.id);
  assert.equal(service.getItem("H07").stock, 95);
  assert.equal(service.listItems().find((item) => item.code === "H07").consumed, 5);
  assert.equal(service.getOverview().submissionCount, 1);
  assert.throws(() => service.revert(first.submission.id), /已经撤销/);
  assert.throws(() => service.revert("不存在"), /找不到/);
});

test("缺货清单按最低库存线计算缺口", () => {
  const { service } = makeService();
  service.upsertItem("A11", { stock: 10, minStock: 50 });
  service.upsertItem("B03", { stock: 80, minStock: 20 });
  service.upsertItem("H07", { stock: 20, minStock: 20 });
  const low = service.listReplenish();
  assert.equal(low.length, 1);
  assert.equal(low[0].code, "A11");
  assert.equal(low[0].deficit, 40);
  assert.equal(service.getOverview().lowCount, 1);
  assert.equal(service.getOverview().itemCount, 3);
});

test("listItems 支持搜索位置/供应商/备注", () => {
  const { service } = makeService();
  service.upsertItem("A11", { stock: 1, minStock: 0, location: "抽屉 2", supplier: "某宝" });
  service.upsertItem("B03", { stock: 1, minStock: 0, note: "备用" });
  assert.deepEqual(service.listItems({ search: "抽屉" }).map((item) => item.code), ["A11"]);
  assert.deepEqual(service.listItems({ search: "某宝" }).map((item) => item.code), ["A11"]);
  assert.deepEqual(service.listItems({ search: "备用" }).map((item) => item.code), ["B03"]);
  assert.equal(service.listItems({ search: "不存在" }).length, 0);
});

test("removeItem 在有流水时拒绝删除", () => {
  const { service } = makeService();
  service.upsertItem("A11", { stock: 5, minStock: 0 });
  service.upsertItem("B03", { stock: 5, minStock: 0 });
  service.consume({ lines: [{ code: "A11", count: 1 }] });
  assert.throws(() => service.removeItem("A11"), /不能直接删除/);
  service.removeItem("B03");
  assert.equal(service.getItem("B03"), null);
});

test("CSV 导出带 BOM 与完整表头，且能被自己导入回来", () => {
  const { service } = makeService();
  service.upsertItem("A11", { stock: 120, minStock: 50, location: "A1", supplier: "厂商甲", note: "含逗号,需转义" });
  service.upsertItem("B03", { stock: 8, minStock: 0 });
  const csv = service.exportCsv();
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.slice(1).split("\r\n")[0], CSV_HEADERS.join(","));
  assert.ok(csv.includes('"含逗号,需转义"'));

  const fresh = makeService();
  const result = fresh.service.importCsv(csv);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  assert.equal(fresh.service.getItem("A11").stock, 120);
  assert.equal(fresh.service.getItem("A11").note, "含逗号,需转义");
  assert.equal(fresh.service.getItem("A11").location, "A1");
});

test("CSV 导入按表头读列，容忍列顺序变化与缺列", () => {
  const { service } = makeService();
  const csv = ["最低库存,编号,当前库存", "30, a11 ,88", "0,B03,5"].join("\n");
  const result = service.importCsv(csv);
  assert.equal(result.imported, 2);
  assert.equal(service.getItem("A11").stock, 88);
  assert.equal(service.getItem("A11").minStock, 30);
  assert.equal(service.getItem("B03").stock, 5);
});

test("CSV 导入报告非法行而不是静默跳过", () => {
  const { service } = makeService();
  const csv = ["编号,当前库存,最低库存", "A11,10,2", ",5,1", "B03,abc,1", "H07,3,x"].join("\n");
  const result = service.importCsv(csv);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 3);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.some((message) => message.includes("编号为空")));
  assert.ok(result.errors.some((message) => message.includes("B03")));
  assert.ok(result.errors.some((message) => message.includes("H07")));
  assert.equal(service.getItem("H07"), null);
});

test("CSV 表头缺失时明确报错", () => {
  const { service } = makeService();
  assert.throws(() => service.importCsv("色号,库存\nA11,1"), /缺少「编号」/);
  assert.throws(() => service.importCsv("编号,备注\nA11,x"), /「当前库存」或「最低库存」/);
  assert.throws(() => service.importCsv(""), /CSV 是空的/);
});

test("parseCsv 处理引号、字段内逗号与换行", () => {
  const rows = parseCsv('a,b\n"x,1","he said ""hi"""\n"line\nbreak",z');
  assert.deepEqual(rows[0], ["a", "b"]);
  assert.deepEqual(rows[1], ["x,1", 'he said "hi"']);
  assert.deepEqual(rows[2], ["line\nbreak", "z"]);
});

test("台账会持久化，并能从损坏数据中恢复", () => {
  const storage = memoryStorage();
  const first = makeService({ storage });
  first.service.upsertItem("A11", { stock: 42, minStock: 5 });
  assert.equal(storage.dump().items.A11.stock, 42);

  const second = makeService({ storage });
  assert.equal(second.service.getItem("A11").stock, 42);
  assert.equal(second.service.getItem("A11").name, "正红");

  const broken = memoryStorage();
  broken.setItem("libms-inventory-v1", "{ 这不是 JSON");
  const third = makeService({ storage: broken });
  assert.equal(third.service.listItems().length, 0);
});

test("订阅者能收到变更通知", () => {
  const { service } = makeService();
  let calls = 0;
  const off = service.subscribe(() => { calls += 1; });
  service.upsertItem("A11", { stock: 1, minStock: 0 });
  assert.equal(calls, 1);
  off();
  service.upsertItem("A11", { stock: 2, minStock: 0 });
  assert.equal(calls, 1);
});
