import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/shared-tracking.js',import.meta.url),'utf8');
async function run(names){
  const tooltips=[],elements=new Map();
  const element=()=>({textContent:'',innerHTML:''});
  const context={
    location:{hash:'#'+'a'.repeat(64)},
    document:{hidden:false,createElement:tag=>({...element(),tagName:tag.toUpperCase()}),querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector)},addEventListener(){}},
    L:{map:()=>({setView(){return this},fitBounds(){}}),tileLayer:()=>({addTo(){return this}}),marker:point=>({addTo(){return this},bindTooltip(content){tooltips.push(content);return this},getLatLng:()=>point,remove(){}})},
    fetch:async()=>({ok:true,json:async()=>({status:'riding',pickup:{lat:24.7,lng:46.6,name:names[0]},destination:{lat:24.71,lng:46.61,name:names[1]},location:null})}),
    setInterval(){},setTimeout(){},clearTimeout(){},requestAnimationFrame(){},cancelAnimationFrame(){},performance:{now:()=>0},console,
  };
  vm.runInNewContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {tooltips,elements};
}

test('shared trip tooltips use DOM text for untrusted pickup and destination names',async()=>{
  const names=['<img src=x onerror="globalThis.exploited=true">','<svg onload="globalThis.exploited=true">'];
  const {tooltips,elements}=await run(names);
  assert.equal(tooltips.length,2);
  for(let i=0;i<names.length;i++){
    assert.equal(typeof tooltips[i],'object','Leaflet must receive a DOM node, not an HTML string');
    assert.equal(tooltips[i].textContent,names[i]);
    assert.equal(tooltips[i].innerHTML,'','Names must never enter the HTML sink');
  }
  assert.ok(elements.get('#share-details').innerHTML.includes('&lt;img'));
});

test('shared trip tooltips preserve ordinary Arabic names and punctuation',async()=>{
  const names=['شارع الملك فهد — بوابة ٢','مكتبة "مشوار" & المقهى'];
  const {tooltips}=await run(names);
  assert.deepEqual(tooltips.map(node=>node.textContent),names);
});
