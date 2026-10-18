import {paletteIdOf} from './palette-identity.js';

/** Resolve a shared palette click into a text-object property patch. */
export function textColorTargetPatch(layer, target, color, palette) {
  if (!layer || layer.locked) throw new Error('请先选择并解锁图层');
  const id=paletteIdOf(color);
  if (!id || !palette.some(item=>paletteIdOf(item)===id)) throw new Error('请选择当前可用色卡中的颜色');
  const hex='#'+color.rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
  if (target.role==='text') return {color:color.code,paletteId:id,textHex:''};
  if (target.role==='gradient') {
    const stops=structuredClone(layer.gradientStops||[]);
    if (!Number.isInteger(target.index)||target.index<0||target.index>=stops.length) throw new Error('渐变色点已改变，请重新选择');
    stops[target.index]={paletteId:id,code:color.code,hex};
    return {gradientStops:stops};
  }
  if (!['shadow','backplate','border','glow'].includes(target.role)) throw new Error('未知的文字选色项目');
  return {[`${target.role}Hex`]:hex,[`${target.role}PaletteId`]:id};
}
