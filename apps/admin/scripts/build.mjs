import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..'),output=join(root,'dist');
const types={'.apk':'application/vnd.android.package-archive','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.txt':'text/plain; charset=utf-8','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
// Match the other application builds: private source files remain in the
// checkout and never enter either hosting target's published asset set.
const privateName=name=>name.startsWith('.')||/(?:^|[._-])(?:backups?|bak|old|orig|save|before|env|secrets?|credentials?)(?:[._-]|$)|~(?:\.|$)/i.test(name)||/^node_modules$/i.test(name);
function files(prefix=''){
 const found=[];
 for(const item of readdirSync(join(root,'public',prefix),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
  if(privateName(item.name))continue;
  const relative=prefix+item.name;
  if(item.isDirectory())found.push(...files(relative+'/'));
  else if(item.isFile()&&types[extname(item.name).toLowerCase()])found.push(relative);
 }
 return found;
}
const publicFiles=files(),assets={};
// Only generated output beneath this application can be removed.
if(resolve(output,'..')!==root)throw Error('Build output must stay inside the app');
rmSync(output,{recursive:true,force:true});
for(const directory of ['public','server','.openai'])mkdirSync(join(output,directory),{recursive:true});
for(const file of publicFiles){
 const bytes=readFileSync(join(root,'public',file)),destination=join(output,'public',file);
 mkdirSync(resolve(destination,'..'),{recursive:true});writeFileSync(destination,bytes);
 assets['/'+file]={type:types[extname(file).toLowerCase()],data:bytes.toString('base64')};
}
writeFileSync(join(output,'server/index.js'),'const ASSETS='+JSON.stringify(assets)+';\n'+readFileSync(join(root,'worker/index.js'),'utf8'));
writeFileSync(join(output,'.openai/hosting.json'),readFileSync(join(root,'.openai/hosting.json')));
console.log('Built administration Worker and filtered Vercel static output');
