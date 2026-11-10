// Local preview only: synthetic admin identity and fixtures never enter production.
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const hubRoot=process.env.MISHWAR_HUB_CHECKOUT||resolve(existsSync('../hub/package.json')?'../hub':'../../hub/.sites-checkout');
const {makeEnv}=await import(pathToFileURL(hubRoot+'/tests/fixtures.mjs'));
const hub=(await import(pathToFileURL(hubRoot+'/dist/server/index.js'))).default;
const portal=(await import('../dist/server/index.js')).default;
const hubEnv=makeEnv(true),env={ADMIN_EMAIL:'admin@example.com',HUB_URL:'https://hub.local',HUB_SERVICE_KEY:'test-admin-key',HUB_ACCESS_TOKEN:'local-qa-only'};
const nativeFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;return url.startsWith('https://hub.local/')?hub.fetch(new Request(url,init),hubEnv,{waitUntil(p){p.catch(()=>{})}}):nativeFetch(input,init)};
createServer(async(req,res)=>{try{if(req.url==='/qa-reset'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(`<button onclick="(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.href='/#recharge-cards'})()">إعادة ضبط المعاينة المحلية</button>`);return}const chunks=[];for await(const c of req)chunks.push(c);const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);headers.set('oai-authenticated-user-id','qa-admin');headers.set('oai-authenticated-user-email','admin@example.com');const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});const result=await portal.fetch(request,env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()))}catch(e){console.error(e.message);res.writeHead(500);res.end('Local preview error')}}).listen(Number(process.env.PORT||4173),'0.0.0.0',()=>console.log('Administration preview ready'));
