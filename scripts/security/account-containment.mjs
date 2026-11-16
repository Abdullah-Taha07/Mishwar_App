// Account incident planning and rehearsal only. This module has no Cloudflare API,
// network requests or production mutation command. All identity-bearing output is private.
import {DatabaseSync,constants} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const fail=code=>{throw Object.assign(new Error(code),{code})};
const ensure=(value,code)=>{if(!value)fail(code)};
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const hasTable=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);
const rows=(db,table)=>db.prepare('SELECT * FROM '+quote(table)).all();
const cell=value=>typeof value==='bigint'?['integer',value.toString()]:value instanceof Uint8Array?['blob',Buffer.from(value).toString('hex')]:[typeof value,value];
const fingerprint=values=>hash(JSON.stringify(values.map(row=>Object.keys(row).sort().map(key=>[key,cell(row[key])])).map(row=>JSON.stringify(row)).sort()));

export function restorePrivateSql(bytes,path=':memory:'){
  const sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  ensure(!/TEST\s+FILE\s+ONLY/i.test(sql)&&/CREATE\s+TABLE/i.test(sql),'REAL_SQL_REQUIRED');
  const db=new DatabaseSync(path);
  try{
    db.enableDefensive(true);
    db.exec('PRAGMA foreign_keys=OFF');
    db.setAuthorizer((action,first,second,database)=>{
      if([constants.SQLITE_ATTACH,constants.SQLITE_DETACH].includes(action))return constants.SQLITE_DENY;
      if(database&&!['main','temp'].includes(database))return constants.SQLITE_DENY;
      if(action===constants.SQLITE_FUNCTION&&/^(load_extension|readfile|writefile|eval)$/i.test(second||first||''))return constants.SQLITE_DENY;
      if(action===constants.SQLITE_PRAGMA&&!['foreign_keys','defer_foreign_keys'].includes((first||'').toLowerCase()))return constants.SQLITE_DENY;
      return constants.SQLITE_OK;
    });
    db.exec(sql);
    if(db.isTransaction)db.exec('COMMIT');
    db.setAuthorizer(null);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=OFF');
    ensure(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','RESTORE_INTEGRITY_FAILED');
    ensure(db.prepare('PRAGMA foreign_key_check').all().length===0,'RESTORE_FOREIGN_KEY_FAILED');
    return db;
  }catch{db.close();fail('PRIVATE_SQL_RESTORE_FAILED')}
}

export function exposureManifest(exposedDb){
  ensure(hasTable(exposedDb,'public_accounts'),'EXPOSURE_ACCOUNT_SCHEMA_REQUIRED');
  const accounts=exposedDb.prepare('SELECT role,actor,phone,email,password_hash,salt FROM public_accounts ORDER BY role,actor').all();
  return {format:'mishwar-account-exposure-v1',classification:'CONFIDENTIAL-IDENTITY-AND-CREDENTIAL-HASHES',
    accounts:accounts.map(account=>({...account,ownerClassification:'not-confirmed',confirmedRealOwner:false})),
    exposedSessions:hasTable(exposedDb,'public_sessions')?exposedDb.prepare('SELECT token_hash,actor,role,expires_at FROM public_sessions').all():[],
    exposedRecovery:hasTable(exposedDb,'account_recovery')?exposedDb.prepare('SELECT id,token_hash,actor,role,phone,expires_at FROM account_recovery').all():[],
    exposedPushEndpointHashes:hasTable(exposedDb,'push_subscriptions')?exposedDb.prepare('SELECT endpoint_hash FROM push_subscriptions').all().map(x=>x.endpoint_hash):[],
    exposedPushBindings:hasTable(exposedDb,'push_subscriptions')?exposedDb.prepare('SELECT endpoint_hash,role,actor_id,session_hash FROM push_subscriptions').all():[],
    exposedRecordCounts:Object.fromEntries(['public_accounts','public_sessions','account_recovery','push_subscriptions'].map(table=>[table,hasTable(exposedDb,table)?rows(exposedDb,table).length:0]))};
}

export function assessLocalAccounts(exposure,db,at=new Date().toISOString()){
  const assessments=exposure.accounts.map(a=>{
    const current=db.prepare('SELECT role,actor,phone,password_hash,salt FROM public_accounts WHERE role=? AND actor=?').get(a.role,a.actor);
    if(!current){
      const reused=Number(db.prepare('SELECT count(*) AS n FROM public_accounts WHERE role=? AND phone=?').get(a.role,a.phone).n);
      return {role:a.role,actor:a.actor,state:'not-present',ownerClassification:'not-confirmed',contactReusedByDifferentIdentity:reused>0};
    }
    const unchanged=current.password_hash===a.password_hash&&current.salt===a.salt;
    const count=(sql,...params)=>Number(db.prepare(sql).get(...params).n);
    return {role:a.role,actor:a.actor,state:unchanged?'exposed-password-still-current':'password-already-changed',ownerClassification:'not-confirmed',phoneUnchanged:current.phone===a.phone,
      currentSessions:count('SELECT count(*) AS n FROM public_sessions WHERE role=? AND actor=?',a.role,a.actor),
      activeSessions:count('SELECT count(*) AS n FROM public_sessions WHERE role=? AND actor=? AND expires_at>?',a.role,a.actor,at),
      activeRecovery:hasTable(db,'account_recovery')?count('SELECT count(*) AS n FROM account_recovery WHERE role=? AND actor=? AND expires_at>? AND consumed_at IS NULL',a.role,a.actor,at):0};
  });
  return {format:'mishwar-account-assessment-v1',scope:'local-copy-only',assessedAt:at,assessments};
}

export function summarizeAssessment(exposure,assessment){
  const list=assessment.assessments;
  return {scope:assessment.scope,assessedAt:assessment.assessedAt,exposedRecordCounts:exposure.exposedRecordCounts,
    exposedAccounts:exposure.accounts.length,matchingCurrentAccounts:list.filter(x=>x.state!=='not-present').length,
    exposedPasswordStillCurrent:list.filter(x=>x.state==='exposed-password-still-current').length,
    passwordAlreadyChanged:list.filter(x=>x.state==='password-already-changed').length,
    accountsNotPresent:list.filter(x=>x.state==='not-present').length,
    contactReusedByDifferentIdentity:list.filter(x=>x.contactReusedByDifferentIdentity).length,
    activeAffectedPublicSessions:list.reduce((n,x)=>n+(x.activeSessions||0),0),
    activeAffectedRecoveryRequests:list.reduce((n,x)=>n+(x.activeRecovery||0),0),
    realOwnerClassification:'requires-owner-confirmation; never inferred from names, email, or fixture-looking data',productionChanges:false};
}

function belongs(row,table,target,sessionHashes){
  if(table==='rider_sessions')return target.role==='rider'&&row.actor===target.actor;
  if(table==='phone_challenges')return target.role==='rider'&&row.phone===target.phone;
  if(['push_subscriptions','native_device_tokens'].includes(table))return row.role===target.role&&sessionHashes.has(row.session_hash);
  return row.role===target.role&&row.actor===target.actor;
}

/** Destructive operations are allowed only in a newly created local rehearsal DB.
 * No password is assigned: replacement requires owner-controlled verified reset.
 * The original credential tuple is an optimistic guard, not an authentication token.
 */
export function rehearseAccountContainment({sqlPath,exposure,outputDirectory,selectedAccounts,at=new Date().toISOString()}){
  ensure(Array.isArray(selectedAccounts)&&selectedAccounts.length>0,'EXPLICIT_SELECTION_REQUIRED');
  const targets=selectedAccounts.map(selection=>{
    const target=exposure.accounts.find(x=>x.role===selection.role&&x.actor===selection.actor);
    ensure(target,'TARGET_NOT_IN_EXPOSED_MANIFEST');return target;
  });
  ensure(new Set(targets.map(x=>x.role+'\0'+x.actor)).size===targets.length,'DUPLICATE_TARGET');
  ensure(Number.isFinite(Date.parse(at)),'VALID_REFERENCE_TIME_REQUIRED');
  const sourcePath=realpathSync(sqlPath),bytes=readFileSync(sourcePath),sourceSha256=hash(bytes);
  const directory=resolve(outputDirectory);mkdirSync(directory,{recursive:false,mode:0o700});
  const databasePath=join(directory,'account-containment-rehearsal.sqlite');
  const db=restorePrivateSql(bytes,databasePath);
  const touched=['public_sessions','rider_sessions','account_recovery','email_auth_tokens','public_phone_otp','account_changes','phone_challenges','push_subscriptions','native_device_tokens'];
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);
  const before=Object.fromEntries(tables.map(table=>[table,rows(db,table)]));
  const targetSessions=new Map(targets.map(t=>[t,new Set(before.public_sessions.filter(r=>r.role===t.role&&r.actor===t.actor).map(r=>r.token_hash))]));
  const allowed=Object.fromEntries(touched.filter(t=>hasTable(db,t)).map(table=>[table,before[table].filter(row=>targets.some(t=>belongs(row,table,t,targetSessions.get(t))))]));
  const counts={};
  try{
    db.exec('BEGIN IMMEDIATE');
    for(const target of targets){
      const current=db.prepare('SELECT phone,password_hash,salt FROM public_accounts WHERE role=? AND actor=?').get(target.role,target.actor);
      ensure(current&&current.phone===target.phone&&current.password_hash===target.password_hash&&current.salt===target.salt,'STALE_OR_CHANGED_ACCOUNT_ABORT_ALL');
    }
    for(const target of targets){
      const actor=target.actor,role=target.role;
      for(const table of ['push_subscriptions','native_device_tokens'])if(hasTable(db,table))db.prepare(`DELETE FROM ${quote(table)} WHERE role=? AND session_hash IN (SELECT token_hash FROM public_sessions WHERE role=? AND actor=?)`).run(role,role,actor);
      db.prepare('DELETE FROM public_sessions WHERE role=? AND actor=?').run(role,actor);
      if(role==='rider'&&hasTable(db,'rider_sessions'))db.prepare('DELETE FROM rider_sessions WHERE actor=?').run(actor);
      for(const table of ['account_recovery','email_auth_tokens','public_phone_otp','account_changes'])if(hasTable(db,table))db.prepare(`UPDATE ${quote(table)} SET expires_at=MIN(expires_at,?) WHERE role=? AND actor=?`).run(at,role,actor);
      if(role==='rider'&&hasTable(db,'phone_challenges'))db.prepare('UPDATE phone_challenges SET expires_at=MIN(expires_at,?) WHERE phone=?').run(at,target.phone);
    }
    for(const table of tables){
      const after=rows(db,table);
      if(!touched.includes(table)){ensure(fingerprint(after)===fingerprint(before[table]),'UNRELATED_TABLE_CHANGED');continue}
      const unrelatedBefore=before[table].filter(row=>!targets.some(t=>belongs(row,table,t,targetSessions.get(t))));
      const unrelatedAfter=after.filter(row=>!targets.some(t=>belongs(row,table,t,targetSessions.get(t))));
      ensure(fingerprint(unrelatedBefore)===fingerprint(unrelatedAfter),'UNRELATED_ACCOUNT_CHANGED');
      counts[table]={before:before[table].length,after:after.length,selectedRowsBefore:allowed[table]?.length||0};
    }
    ensure(db.prepare('PRAGMA foreign_key_check').all().length===0,'CONTAINMENT_FOREIGN_KEY_FAILED');
    db.exec('COMMIT');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');db.close();if(error.code&&!error.code.startsWith('ERR_'))throw error;fail('LOCAL_CONTAINMENT_FAILED')}
  db.close();
  const reopened=new DatabaseSync(databasePath,{readOnly:true});
  try{
    ensure(reopened.prepare('PRAGMA integrity_check').get().integrity_check==='ok','REOPEN_INTEGRITY_FAILED');
    ensure(fingerprint(rows(reopened,'public_accounts'))===fingerprint(before.public_accounts),'CREDENTIALS_OR_ACCOUNTS_CHANGED');
  }finally{reopened.close()}
  ensure(hash(readFileSync(sourcePath))===sourceSha256,'SOURCE_CHANGED');
  const report={format:'mishwar-containment-rehearsal-v1',passed:true,scope:'local-copy-only',checkedAt:new Date().toISOString(),selectedAccounts:targets.length,
    realOwnerConfirmationRequired:true,originalSourceSha256:sourceSha256,counts,
    checks:{exactExposedIdentitySelection:true,credentialGuardRecheckedInTransaction:true,unrelatedAccountsPreserved:true,accountCredentialsUnchanged:true,sourceUnchanged:true,persistedDatabaseReopened:true},
    passwordRemediation:'not-applied: use owner-controlled verified reset; never assign a shared/default/unknown password',productionChanges:false};
  const reportPath=join(directory,'account-containment-report.json');writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  return {report,reportPath,databasePath};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.error('LOCAL_LIBRARY_ONLY: import this module from a private local assessment/rehearsal runner; no production mutation command exists');process.exitCode=1;
}
