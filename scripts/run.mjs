import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const action=process.argv[2];if(!['test','build'].includes(action))process.exit(1);
// Cloudflare may install only the root dependencies. Install the hub's isolated bundler
// from apps/hub/package.json when no local or root esbuild is available.
if(action==='build'){
  let found=true;
  try{await import('../apps/hub/node_modules/esbuild/lib/main.js')}catch{try{await import('esbuild')}catch{found=false}}
  if(!found){const npm=process.platform==='win32'?'npm.cmd':'npm';const installed=spawnSync(npm,['install','--prefix','apps/hub','--include=dev','--no-audit','--no-fund'],{stdio:'inherit',shell:process.platform==='win32'});if(installed.status!==0)process.exit(installed.status||1)}
}
for(const app of ['hub','rider','admin']) {
 const cwd=new URL('../apps/'+app+'/',import.meta.url);
 const args=action==='build'?['scripts/build.mjs']:['--test',...readdirSync(new URL('tests/',cwd)).filter(x=>x.endsWith('.test.mjs')).map(x=>'tests/'+x)];
 const p=spawnSync(process.execPath,args,{cwd,stdio:'inherit'});if(p.status!==0)process.exit(p.status||1);
}
