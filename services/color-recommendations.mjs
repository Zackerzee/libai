import { createPaletteMetricCache } from './color-ramp-service.js';
import { paletteIdOf } from './palette-identity.js';

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// Suggestions are editing choices, not a replacement for the generation matcher.
// One step means the next available perceptual lightness within the same hue family.
export function buildColorRecommendationGroups(palette, sourceId, nearby = []) {
  const metrics = createPaletteMetricCache(palette), base = metrics.get(sourceId);
  const groups = [
    {label:'周边用色', colors:nearby.filter(color=>paletteIdOf(color)!==sourceId).slice(0, 4)},
  ];
  if (!base) return groups;
  const others = [...metrics.values()].filter(entry => entry.paletteId !== sourceId);
  const sameHue = others.filter(entry => base.chroma < 10
    ? entry.chroma < 10 : entry.chroma >= 10 && hueDistance(entry.hue, base.hue) <= 25);
  const nextLevel = direction => sameHue.filter(entry => direction * (entry.lightness - base.lightness) > 1)
    .sort((a,b) => Math.abs(a.lightness-base.lightness)-Math.abs(b.lightness-base.lightness)
      || Math.abs(a.chroma-base.chroma)-Math.abs(b.chroma-base.chroma) || a.order-b.order)[0];
  const levels = [[nextLevel(-1),'暗一级'],[nextLevel(1),'亮一级']].filter(([entry])=>entry);
  const contrast = others.filter(entry => base.chroma < 10
    ? Math.abs(entry.lightness-base.lightness) >= 35
    : entry.chroma >= 10 && hueDistance(entry.hue, base.hue) >= 130)
    .sort((a,b) => {
      const score = entry => base.chroma < 10 ? -Math.abs(entry.lightness-base.lightness)
        : Math.abs(180-hueDistance(entry.hue,base.hue)) + Math.abs(entry.lightness-base.lightness)*.25
          + Math.abs(entry.chroma-base.chroma)*.15;
      return score(a)-score(b) || a.order-b.order;
    }).slice(0,2);
  const color = entry => ({...entry.color,paletteId:entry.paletteId});
  return [...groups, {label:'暗一级 / 亮一级',colors:levels.map(([entry,recommendationLabel])=>({...color(entry),recommendationLabel}))}, {label:'对比色',colors:contrast.map(color)}];
}
