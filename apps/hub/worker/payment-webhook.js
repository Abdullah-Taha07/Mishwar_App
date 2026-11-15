/* Public webhook: authenticates Moyasar's shared secret and rechecks payment with Moyasar before changing the ledger. */
import{secretMatches}from'./operations.js';
import{confirmWebhookPayment,livePayments}from'./commerce.js';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function handleMoyasarWebhook(request,env){
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!env.MOYASAR_WEBHOOK_SECRET||env.MOYASAR_WEBHOOK_SECRET.length<32||!livePayments(env))return reply({error:'Webhook is not configured'},503);
 let event;try{const raw=await request.text();if(raw.length>65536)throw Error();event=JSON.parse(raw)}catch{return reply({error:'Invalid event'},400)}
 const headerSecret=request.headers.get('x-event-secret'),bodySecret=event?.secret_token;
 if(!headerSecret&&!bodySecret)return reply({error:'Missing signature'},403);
 if(headerSecret&&!await secretMatches(headerSecret,env.MOYASAR_WEBHOOK_SECRET))return reply({error:'Invalid signature'},403);
 if(bodySecret&&!await secretMatches(bodySecret,env.MOYASAR_WEBHOOK_SECRET))return reply({error:'Invalid signature'},403);
 if(event.type==='webhook_verification')return reply({ok:true,verificationPending:true});
 if(event.live!==true)return reply({error:'Unexpected payment environment'},403);
 if(event.type!=='payment_paid')return reply({ok:true,ignored:true});
 const id=event.data?.id,intentId=event.data?.metadata?.intent_id;
 if(typeof id!=='string'||!(/^[a-zA-Z0-9-]{10,100}$/.test(id))||typeof intentId!=='string'||intentId.length>100)return reply({error:'Invalid payment reference'},400);
 return confirmWebhookPayment(env,intentId,id);
}
