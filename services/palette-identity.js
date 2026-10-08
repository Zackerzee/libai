// 色板颜色的稳定身份。新数据优先使用 paletteId；旧工程/旧色板没有该字段时，
// 以色号 code 作为兼容身份。任何识别、计数与替换都应走这里，不能用 RGB/HEX。
export function paletteIdOf(color) {
  const value = color?.paletteId ?? color?.code;
  return value == null || value === "" ? null : String(value);
}

export function samePaletteColor(a, b) {
  const left = paletteIdOf(a), right = paletteIdOf(b);
  return left !== null && left === right;
}
