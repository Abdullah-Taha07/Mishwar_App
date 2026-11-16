// Local SQLite control only. This tool contains no Cloudflare API or deployment
// path, and never accepts SQL, an HTTP URL, a force flag or a public bypass.
import {DatabaseSync} from 'node:sqlite';
import {realpathSync,lstatSync,existsSync} from 'node:fs';
import {isAbsolute,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {maintenanceSnapshot,transitionMaintenance} from '../worker/maintenance.js';

async function main(){
  const [action,path,...options]=process.argv.slice(2);
  if(!['status','transition'].includes(action)||!path||!isAbsolute(path)||path.startsWith('\\\\')||!path.endsWith('.sqlite')||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('LOCAL_SQLITE_PATH_REQUIRED');
  const workspace=fileURLToPath(new URL('../../../',import.meta.url)),resolved=realpathSync(path);
  const roots=[resolve(workspace,'.local-verification'),resolve(workspace,'..','private-backups')].filter(existsSync).map(root=>realpathSync(root));
  if(resolved.startsWith('\\\\')||!roots.some(root=>{const child=relative(root,resolved);return child!==''&&!child.startsWith('..'+sep)&&child!=='..'&&!isAbsolute(child)}))throw Error('LOCAL_SQLITE_PATH_REQUIRED');
  const database=new DatabaseSync(resolved,{readOnly:action==='status'});
  database.exec('PRAGMA foreign_keys=ON');
  const adapter={prepare(sql){return {bind(...values){return {first:async()=>database.prepare(sql).get(...values)||null,run:async()=>({meta:{changes:database.prepare(sql).run(...values).changes}})}},first:async()=>database.prepare(sql).get()||null}}};
  try{
    if(action==='transition'){
      if(options.length!==4||options[0]!=='--apply-local'||!['open','draining','frozen','validating'].includes(options[1])||!['open','draining','frozen','validating'].includes(options[2])||!/^[1-9]\d*$/.test(options[3]))throw Error('EXPECTED_LOCAL_TRANSITION_ARGUMENTS');
      await transitionMaintenance(adapter,{targetMode:options[1],expectedMode:options[2],expectedEpoch:Number(options[3])});
    }else if(options.length)throw Error('NO_STATUS_OPTIONS_ALLOWED');
    const state=await maintenanceSnapshot(adapter);
    const business=database.prepare(`SELECT
      (SELECT COUNT(*) FROM trips WHERE is_demo=0 AND status IN ('matching','arriving','arrived','riding')) AS activeTrips,
      (SELECT COUNT(*) FROM payment_intents WHERE status='pending') AS pendingRiderPayments,
      (SELECT COUNT(*) FROM driver_payment_intents WHERE status='pending') AS pendingCaptainPayments,
      (SELECT COUNT(*) FROM refund_requests WHERE status IN ('requested','submitted_unknown')) AS pendingOrUnknownRefunds,
      (SELECT COUNT(*) FROM withdrawal_requests WHERE status='pending') AS pendingWithdrawals,
      (SELECT COUNT(*) FROM reservations WHERE status IN ('scheduled','dispatching')) AS scheduledOrDispatchingReservations`).get();
    console.log(JSON.stringify({scope:'local-only',mode:state.mode,epoch:state.epoch,activeLeases:state.active,pendingOrUnknownEffects:state.uncertain,...business},null,2));
  }finally{database.close()}
}
try{await main()}catch(error){
  const codes=['LOCAL_SQLITE_PATH_REQUIRED','EXPECTED_LOCAL_TRANSITION_ARGUMENTS','NO_STATUS_OPTIONS_ALLOWED','MAINTENANCE_INVALID_TRANSITION','MAINTENANCE_DRAIN_NOT_EMPTY'];
  const code=codes.find(code=>String(error?.message).includes(code))||'LOCAL_MAINTENANCE_OPERATION_FAILED';
  console.error(JSON.stringify({scope:'local-only',ok:false,code}));process.exitCode=1;
}
