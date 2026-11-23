import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const app=resolve(import.meta.dirname,'..');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'mishwar-admin-packaging-'));
 t.after(()=>{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('mishwar-admin-packaging-'));rmSync(root,{recursive:true,force:true})});
 for(const name of ['public','worker','scripts','.openai','package.json','vercel.json'])cpSync(join(app,name),join(root,name),{recursive:true});
 return {root,read:path=>readFileSync(join(root,path),'utf8'),build(){const run=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stdout+run.stderr)}};
}
const identity={'oai-authenticated-user-id':'local-admin','oai-authenticated-user-email':'admin@example.test'};
const runtime={ADMIN_EMAIL:'admin@example.test'};
const trustedCtx={access:{getIdentity:async()=>({id:'cf-access-owner',email:'admin@example.test'})}};
async function worker(f){return(await import('data:text/javascript;base64,'+Buffer.from(f.read('dist/server/index.js')).toString('base64'))).default}

test('administration excludes private source artifacts from both Vercel output and Worker assets',async t=>{
 const f=fixture(t),privateFiles=['.env','.dev.vars','.hidden/leak.js','database.sql','database.sqlite','backup/leak.js','portal.js.backup','portal.before-fix.js','private.bak.css','private.orig.js','portal.js~','env.json','secrets.json','credentials.json','source.js.map','node_modules/leak.js'];
 for(const file of privateFiles){mkdirSync(dirname(join(f.root,'public',file)),{recursive:true});writeFileSync(join(f.root,'public',file),'synthetic private packaging fixture')}
 f.build();const config=JSON.parse(f.read('vercel.json'));
 assert.equal(config.outputDirectory,'dist/public','Vercel must serve the filtered build output, not the source directory');
 const portal=await worker(f);
 for(const file of privateFiles){
  assert.equal(existsSync(join(f.root,'public',file)),true,file+' remains in source');
  assert.equal(existsSync(join(f.root,'dist/public',file)),false,file+' is absent from static output');
  assert.equal((await portal.fetch(new Request('https://admin.example.test/'+file,{headers:identity}),runtime,trustedCtx)).status,404,file+' is absent from Worker assets');
 }
});

test('administration preserves legitimate UI assets and APK downloads across hosting targets',async t=>{
 const f=fixture(t);f.build();const portal=await worker(f);
 for(const file of ['index.html','applications.html','portal.js','portal.css','admin-auth.js','sw.js','manifest.webmanifest']){
  assert.deepEqual(readFileSync(join(f.root,'dist/public',file)),readFileSync(join(f.root,'public',file)),file+' is copied intact');
  const response=await portal.fetch(new Request('https://admin.example.test/'+file,{headers:identity}),runtime,trustedCtx);
  assert.equal(response.status,200);assert.equal(await response.text(),f.read('public/'+file));
 }
 const apk='downloads/mishwar-admin.apk',download=await portal.fetch(new Request('https://admin.example.test/'+apk,{headers:identity}),runtime,trustedCtx);
 assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'application/vnd.android.package-archive');assert.match(download.headers.get('Content-Disposition'),/attachment/);
 assert.deepEqual(Buffer.from(await download.arrayBuffer()),readFileSync(join(f.root,'dist/public',apk)));
 assert.equal((await portal.fetch(new Request('https://admin.example.test/'),runtime)).status,403,'Worker administration still requires its trusted identity');
 assert.deepEqual(JSON.parse(f.read('vercel.json')).rewrites,[{source:'/api/admin/:path*',destination:'/api/admin/[...path]'}]);
});

test('administration build resolves its output inside the app even when invoked from another directory',t=>{
 const f=fixture(t),elsewhere=join(f.root,'unrelated');mkdirSync(elsewhere);mkdirSync(join(elsewhere,'dist'));writeFileSync(join(elsewhere,'dist','keep.txt'),'unrelated output');
 const run=spawnSync(process.execPath,[join(f.root,'scripts/build.mjs')],{cwd:elsewhere,encoding:'utf8',windowsHide:true});
 assert.equal(run.status,0,run.stdout+run.stderr);assert.equal(readFileSync(join(elsewhere,'dist','keep.txt'),'utf8'),'unrelated output');assert.equal(existsSync(join(f.root,'dist/public/index.html')),true);
});
