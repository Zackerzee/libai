// Presentation-only ownership: no editor/grid state or modal focus trap.
export function createSurfaceManager({document}){
  const entries=new Map();let active=null;
  const close=(id,restoreFocus=false)=>{const entry=entries.get(id);if(!entry)return;entry.close();if(active===id)active=null;if(restoreFocus)entry.restoreFocus?.();};
  const open=id=>{for(const [other,entry]of entries)if(other!==id&&entry.isOpen())close(other);active=id;};
  document.addEventListener('pointerdown',event=>{for(const [id,entry]of entries)if(entry.isOpen()&&!entry.element.contains(event.target)&&!entry.trigger?.contains(event.target))close(id);},true);
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const id=active&&entries.get(active)?.isOpen()?active:[...entries].reverse().find(([,entry])=>entry.isOpen())?.[0];if(!id)return;event.preventDefault();event.stopImmediatePropagation();close(id,true);},true);
  return {register(id,entry){entries.set(id,entry);return()=>entries.delete(id);},open,close};
}
