(function (root) {
  'use strict';
  const normalizeCode = value => String(value || '').toUpperCase().replace(/^([A-Z]+)0+(\d+)$/, '$1$2');
  function isMardTransparentBead(color, brand) {
    const identityBrand = String(color?.paletteId || '').split(':')[0].toLowerCase();
    const declaredBrand = String(color?.brand || '').toLowerCase();
    // Source codes in compatibility cards are MARD codes, even for other brands.
    // Only a real MARD card may treat H1 as transparent; COCO H01 remains valid.
    const isMard = identityBrand === 'mard' || (!identityBrand && (String(brand).toLowerCase() === 'mard' || /^mard(?:\s|$)/.test(declaredBrand)));
    return isMard && normalizeCode(color?.code) === 'H1';
  }
  function automaticPaletteColors(palette, brand, availableIds = null) {
    const allowed = Array.isArray(availableIds) ? new Set(availableIds) : null;
    return palette.filter(color => !isMardTransparentBead(color, brand)
      && (!allowed || allowed.has(color.paletteId || color.code)));
  }
  root.LibmsAutomaticPalettePolicy = Object.freeze({ isMardTransparentBead, automaticPaletteColors });
})(globalThis);
