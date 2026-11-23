/* Animate navigation once per screen change; GPS and price polling stay still. */
(()=>{
  const rider=document.querySelector('#panel'),captain=document.querySelector('#driver-panel');
  const root=rider||captain;if(!root)return;
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  let previous=null,frame=0,cleanup=0;
  const calm=()=>preference.matches||document.body.classList.contains('no-animation');
  function clear(){
    cancelAnimationFrame(frame);clearTimeout(cleanup);
    root.querySelectorAll('.mw-scene-enter').forEach(node=>node.classList.remove('mw-scene-enter'));
  }
  function update(){
    const key=rider?root.dataset.stage:root.dataset.motionKey;
    if(!key||key===previous)return;previous=key;clear();
    if(calm()||document.hidden||document.querySelector('.sheet-dragging,.ride-sheet-dragging')||document.body.classList.contains('driver-sheet-dragging'))return;
    frame=requestAnimationFrame(()=>{
      if(calm()||!root.isConnected)return;
      const surfaces=rider?[root.querySelector('.ride-scroll')||root.querySelector('.panel-content')]:[...root.children].filter(node=>node.matches('.captain-trip-overview,.live-offer,.welcome,.summary,.panel-title')).slice(0,3);
      for(const surface of surfaces){
        if(!surface||surface.contains(document.activeElement)&&document.activeElement.matches('input,textarea,[contenteditable]'))continue;
        surface.setAttribute('data-motion-surface','');surface.classList.add('mw-scene-enter');
      }
      cleanup=setTimeout(clear,280);
    });
  }
  new MutationObserver(update).observe(root,{attributes:true,attributeFilter:['data-stage','data-motion-key']});
  preference.addEventListener('change',()=>{if(calm())clear()});
  window.addEventListener('pagehide',clear);
  window.addEventListener('mishwar-account-reset',clear);
  update();
})();
