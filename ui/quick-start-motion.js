// Original vector illustration only: no project state, image conversion, or canvas access.
const figure = document.querySelector('.quick-start-motion');
if (figure) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = (name, attrs, parent) => {
    const element = document.createElementNS(namespace, name);
    Object.entries(attrs).forEach(([key,value]) => element.setAttribute(key,String(value)));
    parent.appendChild(element);
    return element;
  };
  const original = figure.querySelector('[data-flower-original]');
  const grid = figure.querySelector('[data-flower-grid]');
  const beads = figure.querySelector('[data-flower-beads]');
  const palette = {P:{fill:'#f17a9c',code:'F04'},Y:{fill:'#ffd45a',code:'A26'},G:{fill:'#47ad79',code:'B08'}};
  const rows = ['.........','..PP.PP..','.PPPPPPP.','.PPYYYPP.','..PYYYP..','.PPYYYPP.','..PPGPP..','....G.G..','...GGG...'];
  svg('path',{d:'M109 111V188M109 166Q137 147 148 162Q135 183 109 177M109 183Q84 161 73 179Q84 193 109 191',fill:'#47ad79',stroke:'#47ad79','stroke-width':8,'stroke-linecap':'round'},original);
  for (let i=0;i<6;i++) {
    const angle = i*Math.PI/3;
    svg('ellipse',{cx:109+Math.cos(angle)*29,cy:91+Math.sin(angle)*29,rx:25,ry:27,fill:'#f17a9c'},original);
  }
  svg('circle',{cx:109,cy:91,r:25,fill:'#ffd45a'},original);
  rows.forEach((row,y) => [...row].forEach((key,x) => {
    const cx=29+x*20, cy=29+y*20;
    const color=palette[key];
    svg('rect',{x:cx-10,y:cy-10,width:20,height:20,fill:color?.fill || '#fff','fill-opacity':color ? .88 : .65,stroke:'#dfd8ea','stroke-width':.6},grid);
    if (color) {
      const text=svg('text',{x:cx,y:cy+2.8,'text-anchor':'middle',fill:'#433544','font-family':'system-ui,sans-serif','font-size':6.5,'font-weight':600},grid);
      text.textContent=color.code;
      svg('circle',{cx,cy,r:8.6,fill:color.fill,stroke:'#ffffff','stroke-opacity':.65,'stroke-width':.6},beads);
      svg('circle',{cx,cy,r:3.1,fill:'#f7f4ff',stroke:'#42314f','stroke-opacity':.15,'stroke-width':.7},beads);
    } else svg('circle',{cx,cy,r:1.1,fill:'#d0c6e2'},beads);
  }));
  const layers=[...figure.querySelectorAll('[data-flower-layer]')];
  const button=figure.querySelector('button');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let pinned=false, target=0, position=0, velocity=0, frame=0, previous=0;
  const render=()=>layers.forEach((layer,i)=>layer.setAttribute('transform',`translate(${(i-1)*position*10} ${(i-1)*position*22})`));
  const tick=(now)=>{
    const dt=Math.min((now-(previous||now-16))/1000,.032);
    previous=now;
    velocity+=(target-position)*160*dt;
    velocity*=Math.exp(-25.3*dt);
    position+=velocity*dt;
    render();
    if (Math.abs(target-position)>.001 || Math.abs(velocity)>.001) frame=requestAnimationFrame(tick);
    else { position=target;velocity=0;frame=0;previous=0;render(); }
  };
  const aim=(value)=>{
    target=value;
    if (reduced.matches || document.hidden) { cancelAnimationFrame(frame);frame=0;previous=0;position=target;velocity=0;render(); }
    else if (!frame) frame=requestAnimationFrame(tick);
  };
  figure.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch') aim(1);});
  figure.addEventListener('pointerleave',()=>aim(pinned?1:0));
  button.addEventListener('click',()=>{pinned=!pinned;button.setAttribute('aria-pressed',String(pinned));button.textContent=pinned?'收起图层':'展开看看';aim(pinned?1:0);});
  reduced.addEventListener('change',()=>aim(target));
  document.addEventListener('visibilitychange',()=>{if(document.hidden) aim(target);});
}
