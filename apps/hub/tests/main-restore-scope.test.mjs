import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

test('MAIN-RESTORE receipt accurately identifies restored public credentials without claiming restored sessions or secrets',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mishwar-main-restore-scope-')),source=join(dir,'synthetic.bin'),output=join(dir,'isolated.sqlite');
 const account={role:'rider',phone:'+966500000089',actor:'main-restore-synthetic',name:'Synthetic only',email:'restore@example.test',salt:'synthetic-salt',password_hash:'synthetic-password-hash',created_at:'2026-11-21T00:00:00Z'};
 const key=Buffer.alloc(32,7),iv=Buffer.alloc(12,8),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([iv,cipher.update(JSON.stringify({format:'mishwar-backup-v1',tables:{public_accounts:[account]}})),cipher.final(),cipher.getAuthTag()]);
 writeFileSync(source,encrypted);
 const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/restore-isolated.mjs',import.meta.url)),'--input',source,'--output',output],{encoding:'utf8',windowsHide:true,env:{...process.env,BACKUP_ENCRYPTION_KEY:key.toString('base64')}});
 assert.equal(run.status,0,run.stderr);const receipt=JSON.parse(run.stdout);
 assert.equal(receipt.publicAccountCredentialsRestored,true);assert.equal(receipt.sessionsRestored,false);assert.equal(receipt.environmentSecretsRestored,false);assert.equal(receipt.documentObjectsRestored,false);
 const db=new DatabaseSync(output);try{assert.equal(db.prepare('SELECT password_hash FROM public_accounts WHERE actor=?').get(account.actor).password_hash,account.password_hash);assert.equal(db.prepare('SELECT COUNT(*) n FROM public_sessions').get().n,0)}finally{db.close()}
 assert.doesNotMatch(run.stdout,/synthetic-password-hash|synthetic-salt|restore@example/);
});
