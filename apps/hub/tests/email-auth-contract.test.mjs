import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const file = p=>readFile(new URL(p,import.meta.url),'utf8');
test('email auth uses expiring one-time hashed tokens and avoids exposing secrets',async()=>{
 const code=await file('../worker/email-auth.js');
 assert.match(code,/crypto\.getRandomValues/);
 assert.match(code,/tokenHash\(token\)/);
 assert.match(code,/consumed_at IS NULL AND expires_at>/);
 assert.match(code,/RESEND_API_KEY/);
 assert.doesNotMatch(code,/console\.log\([^)]*token/);
});
test('rider proxy and UI expose email confirmation and reset endpoints',async()=>{
 const proxy=await file('../../rider/worker/index.js');
 const ui=await file('../../rider/public/rider-auth.js');
 for(const route of ['email-request-verification','email-request-reset','email-confirm','email-reset-password']){
  assert.ok(proxy.includes('/api/auth/'+route),route);
  assert.ok(ui.includes(route),route);
 }
});
test('migration defines unique token hash and verified emails',async()=>{
 const sql=await file('../drizzle/0012_email_auth.sql');
 assert.match(sql,/token_hash TEXT NOT NULL UNIQUE/);
 assert.match(sql,/PRIMARY KEY\(role,actor\)/);
});
