// Convert vertical mouse wheels to horizontal navigation without trapping zoom or edges.
export function usageWheelDelta(event, width) {
  if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return 0;
  const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? width : 1;
  return event.deltaY * unit * 1.8;
}
export function attachUsageWheel(strip) {
  strip.addEventListener('wheel', event => {
    const delta = usageWheelDelta(event, strip.clientWidth);
    const max = strip.scrollWidth - strip.clientWidth;
    if (!delta || max <= 0 || (delta < 0 && strip.scrollLeft <= 0) || (delta > 0 && strip.scrollLeft >= max - 1)) return;
    event.preventDefault();
    strip.scrollLeft = Math.max(0, Math.min(max, strip.scrollLeft + delta));
  }, { passive: false });
}
