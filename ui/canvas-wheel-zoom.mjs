// Reverse ordinary wheel direction without reversing browser pinch gestures.
export function canvasWheelZoomFactor(event) {
  const delta=Number(event.deltaY)||0;
  const pixels=delta*(event.deltaMode===1?16:event.deltaMode===2?240:1);
  return Math.exp(Math.max(-480,Math.min(480,pixels))*(event.ctrlKey?-.0015:.0015));
}
