import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const action=process.argv[2];if(!['test','build'].includes(action))process.exit(1);
for(const app of ['hub','rider','admin']) {
 const cwd=new URL('../apps/'+app+'/',import.meta.url);
 const args=action==='build'?['scripts/build.mjs']:['--test',...readdirSync(new URL('tests/',cwd)).filter(x=>x.endsWith('.test.mjs')).map(x=>'tests/'+x)];
 const p=spawnSync(process.execPath,args,{cwd,stdio:'inherit'});if(p.status!==0)process.exit(p.status||1);
}
