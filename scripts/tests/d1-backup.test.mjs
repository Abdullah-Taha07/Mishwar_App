import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectSql,persistBackup,verifyReceipt,downloadExport,validateProbeTimestamp} from '../d1-backup.mjs';
const sql=Buffer.from('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id)); INSERT INTO parent VALUES(1); INSERT INTO child VALUES(1,1);');
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'mishwar-backup-test-'));return {dir,a:join(dir,'primary'),b:join(dir,'secondary')}};
test('rejects the known padded TEST file and malformed/empty/foreign-key-broken dumps',()=>{
  for(const bytes of [Buffer.from('-- TEST FILE ONLY\n'+'X'.repeat(128500)),Buffer.from('<html>error</html>'),Buffer.from(''),Buffer.from('CREATE TABLE x(id); broken sql'),Buffer.from('CREATE TABLE p(id PRIMARY KEY); CREATE TABLE c(p REFERENCES p(id)); INSERT INTO c VALUES(2);')])assert.throws(()=>inspectSql(bytes));
});
test('two closed files restore and hash in distinct verifier processes; later corruption/missing copy fails',()=>{
  const {a,b}=setup(),receipt=persistBackup(sql,a,b,{kind:'persistence-probe'});
  assert.equal(receipt.files.length,2);assert.ok(receipt.files.every(f=>f.verifierPid!==process.pid));
  assert.equal(receipt.files[0].sha256,receipt.files[1].sha256);
  assert.equal(verifyReceipt(receipt.receiptPath).verified,true);
  const original=readFileSync(receipt.files[1].path);writeFileSync(receipt.files[1].path,Buffer.from('-- TEST FILE ONLY'));
  assert.throws(()=>verifyReceipt(receipt.receiptPath),/SHA256/);
  writeFileSync(receipt.files[1].path,original);unlinkSync(receipt.files[0].path);
  assert.throws(()=>verifyReceipt(receipt.receiptPath));
});
test('same directory aliases cannot count as two locations',()=>{const {a}=setup();assert.throws(()=>persistBackup(sql,a,a),/locations must differ/)});
test('a polling response without bookmark never repeats the export initiation',async()=>{
  let calls=0;await assert.rejects(downloadExport(async()=>{calls++;return {}},'/db'),/bookmark/);assert.equal(calls,1);
});
test('API failures never include returned private error or signed URLs',async()=>{
  await assert.rejects(downloadExport(async()=>({status:'error',error:'secret-sensitive-value'}),'/db'),e=>!e.message.includes('secret-sensitive-value'));
});
test('restore rejects ATTACH and VACUUM INTO without creating a disk database',()=>{
  const {dir}=setup(),target=join(dir,'must-not-be-created.sqlite');
  const literal=target.replaceAll("'","''");
  for(const statement of ["ATTACH DATABASE '"+literal+"' AS outside; CREATE TABLE outside.x(id);","VACUUM INTO '"+literal+"';"]){
    assert.throws(()=>inspectSql(Buffer.from('CREATE TABLE x(id); '+statement)),/SQL cannot/);
    assert.equal(existsSync(target),false);
  }
  for(const statement of ["PRAGMA temp_store_directory='"+dir.replaceAll("'","''")+"';",'PRAGMA writable_schema=ON;',"SELECT load_extension('must-not-load');"]){
    assert.throws(()=>inspectSql(Buffer.from('CREATE TABLE x(id); '+statement)),/SQL cannot/);
  }
});
test('probe timestamp must be finite, recent and not in the future',()=>{
  const now=Date.parse('2026-11-16T18:00:00.000Z');
  for(const value of [undefined,null,'','invalid',Infinity,new Date(now+1).toISOString(),new Date(now-3600001).toISOString()])assert.throws(()=>validateProbeTimestamp(value,now),/last hour/);
  assert.equal(validateProbeTimestamp(new Date(now).toISOString(),now),true);
  assert.equal(validateProbeTimestamp(new Date(now-3600000).toISOString(),now),true);
});
test('signed downloads reject non-Cloudflare hosts and embedded credentials before fetch',async(t)=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('network must not be called')});
  for(const url of ['https://unexpected.invalid/private?token=secret-sensitive-value','https://cloudflarestorage.com.attacker.invalid/file','https://cloudflarestorage.com@unexpected.invalid/file','https://user:password@tenant.r2.cloudflarestorage.com/file','http://tenant.r2.cloudflarestorage.com/file','https://tenant.r2.cloudflarestorage.com:444/file','not-a-url']){
    await assert.rejects(downloadExport(async()=>({status:'complete',result:{signed_url:url}}),'/db'),error=>/D1 download URL/.test(error.message)&&!error.message.includes('secret-sensitive-value')&&!error.message.includes('password'));
  }
  assert.equal(calls,0);
});
test('approved signed download carries no Cloudflare API authorization',async(t)=>{
  let request;
  t.mock.method(globalThis,'fetch',async(url,options)=>{request={url:String(url),options};return {ok:true,arrayBuffer:async()=>sql.buffer.slice(sql.byteOffset,sql.byteOffset+sql.byteLength)}});
  const result=await downloadExport(async()=>({status:'complete',result:{signed_url:'https://tenant.r2.cloudflarestorage.com/private?signature=not-a-real-signature'}}),'/db');
  assert.deepEqual(result.bytes,sql);
  assert.equal(request.options.headers,undefined);
  assert.equal(request.options.redirect,'error');
});
