// Local receipts contain metadata only. Never log SQL, credentials, API bodies or signed URLs.
import {createHash, randomUUID} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync, constants as sqliteConstants} from 'node:sqlite';

const self=fileURLToPath(import.meta.url);
const databaseId='510eb1ef-8814-4313-95e8-b1386ef40f8e';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(message)};
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function inspectSql(bytes){
  const sql=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(/TEST FILE ONLY|^X{32,}|<html|<!DOCTYPE html/im.test(sql))fail('Rejected placeholder or non-SQL content');
  if(!/CREATE\s+TABLE/i.test(sql))fail('No schema in backup');
  const db=new DatabaseSync(':memory:');
  try{
    // A dump must never escape the in-memory restore through ATTACH, VACUUM INTO,
    // filesystem PRAGMAs or extension functions. Authorize every statement.
    db.enableDefensive(true);
    const safePragmas=new Set(['foreign_keys','defer_foreign_keys','encoding','user_version','application_id','integrity_check','foreign_key_check']);
    const unsafeFunctions=new Set(['load_extension','readfile','writefile','edit','eval','fts3_tokenizer']);
    db.setAuthorizer((action,detail,functionName)=>{
      if(action===sqliteConstants.SQLITE_ATTACH||action===sqliteConstants.SQLITE_DETACH)return sqliteConstants.SQLITE_DENY;
      if(action===sqliteConstants.SQLITE_PRAGMA&&!safePragmas.has(String(detail).toLowerCase()))return sqliteConstants.SQLITE_DENY;
      if(action===sqliteConstants.SQLITE_FUNCTION&&unsafeFunctions.has(String(functionName).toLowerCase()))return sqliteConstants.SQLITE_DENY;
      return sqliteConstants.SQLITE_OK;
    });
    db.exec('PRAGMA foreign_keys=OFF;');
    try{db.exec(sql)}catch{fail('SQL cannot be restored into isolated SQLite (content withheld)')}
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    if(!tables.length)fail('Restore contains no tables');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('SQLite integrity check failed');
    if(db.prepare('PRAGMA foreign_key_check').all().length)fail('Restored backup has foreign key violations');
    return {tableCount:tables.length,rowCount:tables.reduce((n,t)=>n+Number(db.prepare('SELECT count(*) AS n FROM '+quote(t.name)).get().n),0),integrity:'ok',foreignKeyViolations:0};
  }finally{db.close()}
}

export function verifyFile(file,expected){
  if(!isAbsolute(file)||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())fail('Backup must be an absolute regular file');
  const bytes=readFileSync(file),sha256=digest(bytes);
  if(expected&&sha256!==expected)fail('Backup SHA256 mismatch');
  return {path:realpathSync(file),bytes:bytes.length,sha256,...inspectSql(bytes),checkedAt:new Date().toISOString(),verifierPid:process.pid};
}

function writeNew(file,bytes){
  if(existsSync(file))fail('Refusing to overwrite an existing backup or receipt');
  const part=file+'.'+randomUUID()+'.part';
  const fd=openSync(part,'wx',0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd)}finally{closeSync(fd)}
  // The name includes a UUID; no cleanup ever removes a completed SQL file.
  if(existsSync(file))fail('Destination appeared while writing');
  renameSync(part,file);
}

function childVerify(file,sha256){
  const child=spawnSync(process.execPath,[self,'verify-file',file,sha256],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});
  if(child.status!==0)fail('Independent backup verification failed (details withheld)');
  try{return JSON.parse(child.stdout)}catch{fail('Independent verifier returned no receipt')}
}

export function persistBackup(bytes,primary,secondary,{kind='production-export',source={}}={}){
  if(!isAbsolute(primary)||!isAbsolute(secondary))fail('Use explicit absolute backup directories');
  mkdirSync(primary,{recursive:true,mode:0o700});mkdirSync(secondary,{recursive:true,mode:0o700});
  if(realpathSync(primary).toLowerCase()===realpathSync(secondary).toLowerCase())fail('Backup locations must differ');
  inspectSql(bytes);
  const name=(kind==='persistence-probe'?'persistence-probe-':'mishwar-db-backup-')+new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+randomUUID()+'.sql';
  const sha256=digest(bytes),files=[];
  for(const dir of [primary,secondary]){const path=join(realpathSync(dir),name);writeNew(path,bytes);files.push(childVerify(path,sha256))}
  const receipt={schemaVersion:1,kind,createdAt:new Date().toISOString(),writerPid:process.pid,source,sha256,files};
  const receiptPath=join(realpathSync(primary),name+'.receipt.json');
  writeNew(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  return {receiptPath,...receipt};
}

export function verifyReceipt(receiptPath){
  const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
  if(receipt.schemaVersion!==1||!Array.isArray(receipt.files)||receipt.files.length!==2||!/^[a-f0-9]{64}$/.test(receipt.sha256))fail('Invalid backup receipt');
  const files=receipt.files.map(f=>verifyFile(f.path,receipt.sha256));
  if(new Set(files.map(f=>f.path.toLowerCase())).size!==2)fail('Receipt must reference two different files');
  return {receiptPath:resolve(receiptPath),kind:receipt.kind,verified:true,sha256:receipt.sha256,files,checkedAt:new Date().toISOString(),verifierPid:process.pid};
}

export function validateProbeTimestamp(createdAt,now=Date.now()){
  const timestamp=typeof createdAt==='string'?Date.parse(createdAt):NaN;
  if(!Number.isFinite(timestamp)||timestamp>now||now-timestamp>3600000)fail('A verified persistence probe from the last hour is required');
  return true;
}

function tokenFromLocalLogin(){
  if(process.env.CLOUDFLARE_API_TOKEN)return process.env.CLOUDFLARE_API_TOKEN;
  const paths=[process.env.WRANGLER_CONFIG_PATH,join(homedir(),'AppData','Roaming','xdg.config','.wrangler','config','default.toml'),join(homedir(),'.config','.wrangler','config','default.toml')].filter(Boolean);
  for(const path of paths)if(existsSync(path)){
    const text=readFileSync(path,'utf8'),token=text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
    const expires=text.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
    if(token&&(!expires||Date.parse(expires)>Date.now()))return token;
  }
  // Wrangler owns OAuth refresh. Capture all output; a credential must never reach logs.
  const cli=process.env.WRANGLER_AUTH_CLI||join(homedir(),'Mishwar_Wrangler_Export_V2','node_modules','wrangler','bin','wrangler.js');
  if(existsSync(cli)){
    const auth=spawnSync(process.execPath,[cli,'auth','token','--json'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    if(auth.status===0){
      try{const credentials=JSON.parse(auth.stdout);if(['oauth','api_token'].includes(credentials.type)&&typeof credentials.token==='string'&&credentials.token)return credentials.token}catch{}
    }
  }
  fail('No current Cloudflare login: refresh Wrangler login locally; never paste tokens into chat');
}

export async function connectCloudflare(){
  const token=tokenFromLocalLogin();
  const api=async(path,body)=>{
    let response;
    try{response=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)})}catch{fail('Cloudflare request failed (network details withheld)')}
    if(!response.ok)fail('Cloudflare request rejected, HTTP '+response.status);
    let json;try{json=await response.json()}catch{fail('Cloudflare returned non-JSON')}
    if(json.success===false)fail('Cloudflare API reported failure (response withheld)');
    return json.result;
  };
  const accounts=process.env.CLOUDFLARE_ACCOUNT_ID?[{id:process.env.CLOUDFLARE_ACCOUNT_ID}]:await api('/accounts?per_page=50');
  if(!Array.isArray(accounts)||accounts.length!==1)fail('Set CLOUDFLARE_ACCOUNT_ID locally to select exactly one account');
  const account=accounts[0].id;
  if(!/^[a-f0-9]{32}$/i.test(account))fail('Invalid account identifier');
  return {api,prefix:'/accounts/'+account,dbPath:'/accounts/'+account+'/d1/database/'+databaseId};
}

export async function downloadExport(api,dbPath){
  let bookmark;
  for(let attempt=0;attempt<120;attempt++){
    const result=await api(dbPath+'/export',{output_format:'polling',...(bookmark?{current_bookmark:bookmark}:{})});
    if(result.status==='error')fail('D1 export failed (response withheld)');
    if(result.status==='complete'){
      let url;try{url=new URL(result.result?.signed_url||'')}catch{fail('D1 download URL is invalid (private URL withheld)')}
      if(url.protocol!=='https:'||!/(^|\.)cloudflarestorage\.com$/i.test(url.hostname)||url.username||url.password||url.port)fail('D1 download URL must use approved HTTPS Cloudflare object storage');
      // No API credentials are sent to the signed download endpoint.
      let response;try{response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)})}catch{fail('D1 download failed (signed URL withheld)')}
      if(!response.ok)fail('D1 download rejected, HTTP '+response.status);
      return {bytes:Buffer.from(await response.arrayBuffer()),bookmark:result.at_bookmark||bookmark};
    }
    bookmark=result.at_bookmark||bookmark;
    if(!bookmark)fail('Export did not provide a polling bookmark; refusing to start another export');
    await pause(1000);
  }
  fail('D1 export polling timed out');
}

async function main(){
  const [action,...args]=process.argv.slice(2);
  if(action==='verify-file')return verifyFile(args[0],args[1]);
  if(action==='verify')return verifyReceipt(args[0]);
  if(action==='probe')return persistBackup(Buffer.from('CREATE TABLE persistence_probe(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO persistence_probe VALUES(1,\'local persistence check\');\n'),args[0],args[1],{kind:'persistence-probe'});
  if(action==='status'){
    const {api,prefix,dbPath}=await connectCloudflare();
    const database=await api(dbPath);
    const deployments=await api(prefix+'/workers/scripts/mishwar-api/deployments');
    const settings=await api(prefix+'/workers/scripts/mishwar-api/settings');
    const query=await api(dbPath+'/query',{sql:'SELECT name FROM d1_migrations ORDER BY id'});
    return {checkedAt:new Date().toISOString(),database:{name:database.name,uuid:database.uuid},deployments:(deployments.deployments||[]).map(d=>({createdOn:d.created_on,versions:d.versions})),bindingNames:(settings.bindings||[]).map(b=>({name:b.name,type:b.type})),appliedMigrations:query.flatMap(q=>q.results||[]).map(r=>r.name)};
  }
  if(action==='export'){
    const proof=verifyReceipt(args[2]);
    const preflight=JSON.parse(readFileSync(args[2],'utf8'));
    if(proof.kind!=='persistence-probe')fail('A verified persistence probe from the last hour is required');
    validateProbeTimestamp(preflight.createdAt);
    if(preflight.writerPid===process.pid)fail('Run probe and export in separate processes');
    const requested=[args[0],args[1]].map(p=>realpathSync(p).toLowerCase()).sort();
    const tested=preflight.files.map(f=>dirname(realpathSync(f.path)).toLowerCase()).sort();
    if(JSON.stringify(requested)!==JSON.stringify(tested))fail('Probe does not cover the requested directories');
    const {api,dbPath}=await connectCloudflare();
    const exported=await downloadExport(api,dbPath);
    return persistBackup(exported.bytes,args[0],args[1],{source:{databaseId,exportedAt:new Date().toISOString(),bookmark:exported.bookmark||null}});
  }
  fail('Usage: d1-backup.mjs probe <primary> <secondary> | verify <receipt> | status | export <primary> <secondary> <probe-receipt>');
}
if(process.argv[1]&&resolve(process.argv[1])===self){
  try{console.log(JSON.stringify(await main(),null,2))}catch(error){
    // Error strings from SQLite, fetch or the filesystem can contain data or URLs.
    const safe=/^(Rejected |No schema|Restore |SQLite |Restored |SQL cannot|Backup |Use explicit|Refusing |Destination |Independent |Invalid |Receipt |No current|Cloudflare |Set CLOUDFLARE|D1 |Export |A verified|Run probe|Probe |Usage:)/.test(error.message);
    console.error(safe?error.message:'Backup operation failed; private error details withheld');process.exitCode=1;
  }
}
