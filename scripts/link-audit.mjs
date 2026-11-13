import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const roots = ['android', 'apps'];
const ignored = new Set(['.png','.jpg','.jpeg','.apk','.jar','.zip','.woff','.webp','.ico','.map']);
const findings=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(e.isFile()&&!ignored.has(e.name.slice(e.name.lastIndexOf('.')))){let text;try{text=await readFile(path,'utf8')}catch{continue}if(new RegExp(['dazzlinglens','chatgpt','site'].join('\\.'),'i').test(text))findings.push(path)}}}
for(const dir of roots)await walk(dir);
if(findings.length){console.error('Legacy ChatGPT domains:',findings.join(', '));process.exitCode=1}else console.log('PASS: no legacy ChatGPT app domains in source');
