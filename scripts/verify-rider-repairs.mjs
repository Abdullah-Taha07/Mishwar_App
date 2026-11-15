import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const source=resolve(fileURLToPath(new URL('..',import.meta.url)));
const stage=(process.argv[2]||'local').replace(/[^a-zA-Z0-9_-]/g,'');
const report=resolve(source,'artifacts','rider-repairs-2026-11-15',stage+'-'+Date.now());
const sandbox=join(report,'verification');
mkdirSync(sandbox,{recursive:true});
// Build hooks generate captain public files. Run them only in this disposable copy.
// Keep every source and old artifact in the real project untouched by verification builds.
for(const entry of readdirSync(source,{withFileTypes:true})){
  if(['artifacts','.git'].includes(entry.name))continue;
  cpSync(join(source,entry.name),join(sandbox,entry.name),{recursive:true,preserveTimestamps:true});
}
function digestTree(root){const out={};if(!existsSync(root))return out;function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isDirectory())walk(f);else out[f.slice(root.length)]=createHash('sha256').update(readFileSync(f)).digest('hex');}}walk(root);return out;}
const protectedRoots=['apps/admin','apps/hub/public'].map(path=>resolve(source,path));
const before=protectedRoots.map(digestTree);
const summary={stage,source,sandbox,network:'fetch blocked unless replaced with an explicit fake',builds:[],tests:[],protectedSourcesUnchanged:false};
let failed=false;
for(const app of ['hub','rider','admin']){
  const cwd=join(sandbox,'apps',app);
  const built=spawnSync(process.execPath,['scripts/build.mjs'],{cwd,encoding:'utf8',windowsHide:true});
  writeFileSync(join(report,app+'-build.log'),(built.stdout||'')+(built.stderr||''));
  summary.builds.push({app,status:built.status});
  if(built.status!==0){failed=true;console.error(app+' build failed\n'+(built.stderr||built.stdout));continue;}
  const files=readdirSync(join(cwd,'tests')).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'tests/'+x);
  const run=spawnSync(process.execPath,['--import',pathToFileURL(join(sandbox,'scripts','offline-fetch-guard.mjs')).href,'--test','--test-reporter=tap',...files],{cwd,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
  const output=(run.stdout||'')+(run.stderr||'');
  writeFileSync(join(report,app+'-tests.tap'),output);
  const number=key=>Number(output.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]||0);
  const result={app,status:run.status,tests:number('tests'),pass:number('pass'),fail:number('fail'),skipped:number('skipped')};
  summary.tests.push(result);
  console.log(JSON.stringify(result));
  if(run.status!==0){failed=true;console.error(output.split('\n').filter((line,i,all)=>line.startsWith('not ok')||line.includes('error:')||i>all.length-15).join('\n'));}
}
summary.protectedSourcesUnchanged=protectedRoots.every((root,i)=>JSON.stringify(digestTree(root))===JSON.stringify(before[i]));
if(!summary.protectedSourcesUnchanged)failed=true;
writeFileSync(join(report,'summary.json'),JSON.stringify(summary,null,2));
console.log('Verification reports: '+report);
process.exitCode=failed?1:0;
