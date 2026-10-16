import { normalizePindouConfig, applyPindouScene, PINDOU_SCENES, PINDOU_RANGES } from '../src/algorithms/pindou-full/config.mjs';

export const PINDOU_FIELD_GROUPS = [
  ['尺寸与适配', ['gridW','gridH','lockAspect','fitMode','rotate','flipH','flipV']],
  ['采样与纹理', ['sampleMode','mosaic','texture','blur','sharpen']],
  ['颜色与量化', ['algo','colors','dither','ditherAmt']],
  ['画面调整', ['brightness','contrast','saturation','gamma']],
  ['背景与透明', ['bgRemove','bgColor','bgTol','alphaTh']],
];
const labels = { gridW:'宽度格数',gridH:'高度格数',lockAspect:'保持原图比例',fitMode:'适配方式',rotate:'旋转',flipH:'水平翻转',flipV:'垂直翻转',sampleMode:'采样方式',mosaic:'马赛克程度',texture:'纹理强度',blur:'预模糊',sharpen:'锐化',algo:'量化方式',colors:'目标色数',dither:'抖动方式',ditherAmt:'抖动强度',brightness:'亮度',contrast:'对比度',saturation:'饱和度',gamma:'伽马',bgRemove:'去除背景',bgColor:'背景颜色',bgTol:'背景容差',alphaTh:'透明阈值' };
const options = {
  sampleMode:[['area','面积平均'],['nearest','最近邻'],['dominant','主色众数'],['edge','边缘保留'],['dpid','细节保留'],['ssim','结构相似采样']],
  algo:[['kmeans','均值聚类'],['mediancut','中位切割'],['direct','直接匹配']],
  dither:[['none','无抖动'],['fs','误差扩散'],['ordered','有序抖动']],
  fitMode:[['cover','填充裁切'],['contain','完整保留'],['stretch','拉伸填满']],
  rotate:[[0,'不旋转'],[90,'顺时针 90°'],[180,'旋转 180°'],[270,'顺时针 270°']],
};
const checks=new Set(['lockAspect','flipH','flipV','bgRemove']);
export function pindouControlsMarkup() {
  const field = key => {
    let control;
    if(options[key]) control=`<select data-pindou-field="${key}">${options[key].map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select>`;
    else if(checks.has(key)) control=`<input type="checkbox" data-pindou-field="${key}">`;
    else if(key==='bgColor') control=`<input type="color" data-pindou-field="${key}">`;
    else {const [min,max]=PINDOU_RANGES[key]; control=`<input type="number" min="${min}" max="${max}" step="${key==='blur'?0.5:1}" data-pindou-field="${key}">`;}
    return `<label class="ws-field">${labels[key]}${control}</label>`;
  };
  return `<p class="ws-muted">完整拼豆引擎独立生成；使用当前可用色卡，不经过 V2.5 智能清理与容差。</p>
    <label class="ws-field">一键预设<select data-pindou-scene><option value="">手动设置</option>${Object.entries(PINDOU_SCENES).map(([id,scene])=>`<option value="${id}">${scene.label}</option>`).join('')}</select></label>
    ${PINDOU_FIELD_GROUPS.map(([label,keys])=>`<div class="ws-section-title">${label}</div>${keys.map(field).join('')}`).join('')}
    <div class="ws-section-title">裁剪区域</div><p class="ws-muted">按旋转后图片的比例输入，0 到 1；关闭时使用全图。</p>
    <label class="ws-field">启用裁剪<input type="checkbox" data-pindou-crop-enabled></label>
    ${[['x','左侧位置'],['y','顶部位置'],['w','裁剪宽度'],['h','裁剪高度']].map(([key,label])=>`<label class="ws-field">${label}<input type="number" min="0" max="1" step="0.01" data-pindou-crop="${key}"></label>`).join('')}
    <button type="button" class="ws-button" data-pindou-reset>恢复引擎默认值</button>`;
}

export function bindPindouControls({root,read,onChange,sourceSize=()=>null,presetRoot=null,isActive=()=>true}) {
  root.innerHTML=pindouControlsMarkup();
  let activeScene = '';
  const sceneButtons = [];
  if (presetRoot) {
    root.querySelector('[data-pindou-scene]').closest('label').hidden = true;
    for (const [id, scene] of Object.entries(PINDOU_SCENES)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'sl-preset-card';
      button.dataset.pindouPreset = id;
      button.title = `完整拼豆引擎：${scene.label}`;
      button.innerHTML = `<span class="sl-preset-copy"><strong>${scene.label}</strong><small>完整拼豆引擎</small></span><span class="sl-preset-check">✓</span>`;
      button.addEventListener('click', () => {
        if (!isActive()) return;
        activeScene = id;
        onChange(applyPindouScene(read(), id)); sync();
      });
      sceneButtons.push(button); presetRoot.append(button);
    }
  }
  const sync=()=>{
    for (const button of sceneButtons) {
      button.disabled = !isActive();
      button.classList.toggle('is-active', isActive() && button.dataset.pindouPreset === activeScene);
      button.setAttribute('aria-pressed', String(isActive() && button.dataset.pindouPreset === activeScene));
    }
    const config=normalizePindouConfig(read());
    root.querySelectorAll('[data-pindou-field]').forEach(el=>{const value=config[el.dataset.pindouField];if(el.type==='checkbox')el.checked=value;else el.value=String(value);});
    root.querySelector('[data-pindou-crop-enabled]').checked=!!config.crop;
    root.querySelectorAll('[data-pindou-crop]').forEach(el=>{el.value=config.crop?.[el.dataset.pindouCrop]??(['w','h'].includes(el.dataset.pindouCrop)?1:0);el.disabled=!config.crop;});
  };
  root.addEventListener('input',event=>{
    const el=event.target;let config=normalizePindouConfig(read());
    activeScene = '';
    if(el.matches('[data-pindou-field]')){
      if(el.type==='number' && el.value==='') return;
      const key=el.dataset.pindouField;
      config[key]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
      const size=sourceSize();
      if(config.lockAspect&&size?.width&&size?.height&&['gridW','gridH','lockAspect'].includes(key)) {
        const sideways=config.rotate===90||config.rotate===270;
        const ratio=(sideways?size.height/size.width:size.width/size.height)
          * (config.crop ? config.crop.w/config.crop.h : 1);
        if(key==='gridH')config.gridW=Math.round(config.gridH*ratio);else config.gridH=Math.round(config.gridW/ratio);
      }
    } else if(el.matches('[data-pindou-scene]')) {
      if(!el.value)return;config=applyPindouScene(config,el.value);
    } else if(el.matches('[data-pindou-crop-enabled], [data-pindou-crop]')) {
      const enabled=root.querySelector('[data-pindou-crop-enabled]').checked;
      config.crop=enabled?Object.fromEntries([...root.querySelectorAll('[data-pindou-crop]')].map(input=>[input.dataset.pindouCrop,Number(input.value)])):null;
    } else return;
    onChange(normalizePindouConfig(config));sync();
  });
  root.querySelector('[data-pindou-reset]').addEventListener('click',()=>{activeScene='';onChange(normalizePindouConfig());sync();});
  sync();return {sync};
}
