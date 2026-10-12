import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('function prepareImageUploadRuntime()'), source.indexOf('async function loadWorkspaceOnce()'));
function fixture(fail = false) {
  const calls = { modules: 0, generation: 0, safety: 0, links: [] };
  const context = vm.createContext({ Promise, calls,
    TFJS_SCRIPT_URL: 'tf', NSFWJS_MODEL_URL: 'model', NSFWJS_WEIGHTS_URL: 'weights', NSFWJS_SCRIPT_URL: 'nsfw',
    document: { createElement: () => ({}), head: { append: link => calls.links.push(link) } },
    importModule: () => { calls.modules++; return fail ? Promise.reject(new Error('network')) : Promise.resolve({}); },
    ensureGenerationRuntime: () => { calls.generation++; return Promise.resolve(); },
    loadLocalSafetyModel: () => { calls.safety++; return Promise.resolve(); },
  });
  vm.runInContext('let workspaceModulesPromise = null; let uploadSafetyAssetsPreloaded = false;\n' + body.replace(/import\(/g, 'importModule('), context);
  return { context, calls };
}
test('upload gesture warms modules once, without mounting or blocking the picker', async () => {
  const { context, calls } = fixture();
  assert.equal(calls.modules, 0);
  const first = context.prepareImageUploadRuntime();
  const second = context.prepareImageUploadRuntime();
  assert.equal(first, second);
  assert.equal(calls.modules, 1);
  assert.equal(calls.generation, 1);
  assert.equal(calls.links.length, 4);
  assert.ok(calls.links.every(link => link.rel === 'preload' && link.as === 'script' && link.crossOrigin === 'anonymous'));
  await first;
  assert.doesNotMatch(body, /bootstrapWorkspace\(|initializeWorkspaceRuntime\(/);
});
test('failed module warmup can retry without duplicate preloads', async () => {
  const { context, calls } = fixture(true);
  await assert.rejects(context.prepareImageUploadRuntime());
  await assert.rejects(context.prepareImageUploadRuntime());
  assert.equal(calls.modules, 2);
  assert.equal(calls.links.length, 4);
});
test('landing boot stays lazy and picker handlers never await warmup', () => {
  const init = source.slice(source.indexOf('function init()'), source.indexOf('function prepareCompatibilityShell()'));
  assert.doesNotMatch(init, /prepareImageUploadRuntime|loadLocalSafetyModel/);
  for (const name of ['startManualImport', 'startPhotoImport', 'startRestoreImport']) {
    const start = source.indexOf(`function ${name}()`);
    const handler = source.slice(start, source.indexOf('\n}', start));
    assert.match(handler, /prepareImageUploadRuntime\(\)/);
    assert.match(handler, /fileInput\.click\(\)/);
    assert.doesNotMatch(handler, /\bawait\b/);
  }
});
test('content scan still completes before source publication and thresholds are unchanged', () => {
  const load = source.slice(source.indexOf('async function loadFile(file)'), source.indexOf('async function prepareLocalImage(file)'));
  assert.ok(load.indexOf('await runLocalContentSafetyCheck(prepared.dataUrl)') < load.indexOf('state.sourceDataUrl = prepared.dataUrl'));
  assert.ok(load.indexOf('if (!safety.allowed)') < load.indexOf('libms:source-loaded'));
  assert.match(source, /Porn: 0\.55,[\s\S]*Hentai: 0\.55,[\s\S]*Sexy: 0\.88/);
  const model = source.slice(source.indexOf('async function loadLocalSafetyModel()'), source.indexOf('function loadScriptOnce(src)'));
  assert.ok(model.indexOf('TFJS_SCRIPT_URL') < model.indexOf('NSFWJS_MODEL_URL'));
  assert.ok(model.indexOf('NSFWJS_MODEL_URL') < model.indexOf('NSFWJS_WEIGHTS_URL'));
  assert.ok(model.indexOf('NSFWJS_WEIGHTS_URL') < model.indexOf('NSFWJS_SCRIPT_URL'));
  assert.match(model, /if \(state\.safetyModelLoading\) return state\.safetyModelLoading/);
});
test('cold and warm safety model requests share loading and classify the local image', async () => {
  let loads = 0;
  let classifyCalls = 0;
  let release;
  const model = { classify: async image => { assert.equal(image, 'local-image'); classifyCalls++; return [{ className: 'Porn', probability: 0.9 }]; } };
  const context = vm.createContext({
    state: {}, window: { tf: {}, model: {}, group1_shard1of1: {}, nsfwjs: { load: () => { loads++; return new Promise(resolve => { release = () => resolve(model); }); } } },
    console, SAFETY_MODEL_LOAD_TIMEOUT: 15000, NSFW_THRESHOLDS: { Porn: 0.55 },
    withTimeout: promise => promise, loadImage: async () => 'local-image',
  });
  vm.runInContext(source.slice(source.indexOf('async function runLocalContentSafetyCheck(dataUrl)'), source.indexOf('function loadScriptOnce(src)')), context);
  const cold = context.loadLocalSafetyModel();
  const duplicate = context.loadLocalSafetyModel();
  assert.equal(loads, 1);
  release();
  assert.equal(await cold, model);
  assert.equal(await duplicate, model);
  assert.equal(await context.loadLocalSafetyModel(), model);
  assert.equal(loads, 1);
  assert.equal((await context.runLocalContentSafetyCheck('data:image/png;base64,local')).allowed, false);
  assert.equal(classifyCalls, 1);
});
test('existing safety unavailable fallback still records failure and does not retry forever', async () => {
  let loads = 0;
  const context = vm.createContext({ state: {}, window: { tf: {}, model: {}, group1_shard1of1: {}, nsfwjs: { load: () => { loads++; return Promise.reject(new Error('network')); } } },
    console: { warn() {} }, SAFETY_MODEL_LOAD_TIMEOUT: 15000, withTimeout: promise => promise });
  vm.runInContext(source.slice(source.indexOf('async function loadLocalSafetyModel()'), source.indexOf('function loadScriptOnce(src)')), context);
  assert.equal(await context.loadLocalSafetyModel(), null);
  assert.equal(context.state.safetyModelUnavailable, true);
  assert.equal(await context.loadLocalSafetyModel(), null);
  assert.equal(loads, 1);
});
