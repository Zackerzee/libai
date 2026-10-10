/** Choose the higher-contrast black/white label against an opaque palette colour. */
export function colorLabelInk(color) {
  const hex = String(color?.hex || '').replace('#', '');
  const rgb = color?.rgb || (/^[a-f\d]{6}$/i.test(hex) ? [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)) : [204,204,204]);
  const linear = rgb.map(v=>{ const c=v/255; return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4; });
  const luminance = linear[0]*0.2126 + linear[1]*0.7152 + linear[2]*0.0722;
  return luminance > 0.179 ? '#111111' : '#ffffff';
}
