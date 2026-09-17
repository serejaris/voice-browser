import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createAdapter,validateInput} from './gateway.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const files=new Set(['controller.html','controller.js','app.js','README.md','style.css','core.js','sandbox.html','sandbox.js','manifest.json','background.js']);
export function createServer({adapter,port=47831,timeoutMs=20000}={}) {
 const token=randomBytes(32).toString('hex'),paired=new Set();let busy=false;let rateStart=Date.now(),rateCount=0;
 const local=`http://127.0.0.1:${port}`;
 const tokenBytes=Buffer.from(token);
 const authenticated=req=>{const v=req.headers['x-session-token'];if(typeof v!=='string'||v.length!==token.length)return false;const bytes=Buffer.from(v);return bytes.length===tokenBytes.length&&timingSafeEqual(bytes,tokenBytes);};
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const fail=(status,code,message)=>send(status,{error:{code,message}});
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.headers.host!==`127.0.0.1:${port}`)return fail(403,'host','Host rejected');
  let url;try{if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))throw Error('target');url=new URL(req.url,local);if(url.origin!==local)throw Error('target');}catch{return fail(400,'schema','Invalid request target');}
  const origin=req.headers.origin;const extensionId=req.headers['x-extension-id']||url.searchParams.get('extensionId');const extensionOrigin=extensionId&&/^[a-p]{32}$/.test(extensionId)?`chrome-extension://${extensionId}`:null;
  if(extensionId&&!extensionOrigin)return fail(400,'schema','Invalid extension ID');
  if(extensionOrigin&&origin&&origin!==extensionOrigin)return fail(403,'origin','Extension origin mismatch');
  const ext=typeof origin==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  if(req.method==='OPTIONS'&&ext&&url.pathname==='/api/status'){res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET','Access-Control-Allow-Headers':'X-Extension-Id','Vary':'Origin'});return res.end();}
  if(req.method==='GET'&&url.pathname==='/api/status'&&(extensionOrigin||ext)){const requested=extensionOrigin||origin;const isPaired=paired.has(requested);if(origin)res.setHeader('Access-Control-Allow-Origin',origin);return send(200,{configured:adapter.configured,provider:'vercel-ai-gateway',model:'typesafe-ai/jev',paired:isPaired,...(isPaired?{sessionToken:token}:{})});}
  if(extensionOrigin&&!paired.has(extensionOrigin))return fail(403,'origin','Connect extension from the local controller first');
  if(origin&&origin!==local&&!paired.has(origin))return fail(403,'origin','Connect extension from the local controller first');
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Content-Type, X-Session-Token, X-Extension-Id'});return res.end();}
  if(req.method==='GET'&&url.pathname==='/api/status')return send(200,{configured:adapter.configured,provider:'vercel-ai-gateway',model:'typesafe-ai/jev',sessionToken:token});
  if(req.method==='POST'&&(url.pathname==='/api/decide'||url.pathname==='/api/session')){
   if(!authenticated(req))return fail(403,'session','Session rejected');
   if(!/^application\/json(?:;|$)/.test(req.headers['content-type']||''))return fail(415,'schema','JSON required');
   let body;try{let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>65536){fail(413,'limit','Request too large');req.resume();return;}chunks.push(c);}body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return fail(400,'schema','Invalid JSON');}
   if(url.pathname==='/api/session'){
    if(origin&&origin!==local)return fail(403,'origin','Pair from local controller');
    if(!body||!/^([a-p]{32})$/.test(body.extensionId||''))return fail(400,'schema','Invalid extension ID');
    paired.add(`chrome-extension://${body.extensionId}`);return send(200,{paired:true});
   }
   try{validateInput(body);}catch{return fail(400,'schema','Invalid state or action candidates');}
   if(!adapter.configured)return fail(503,'configuration','Gateway connection unavailable');
   if(busy)return fail(429,'busy','One decision is already running');
   if(Date.now()-rateStart>60000){rateStart=Date.now();rateCount=0;}if(++rateCount>60)return fail(429,'busy','Decision rate limit reached');
   busy=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
   const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
   try{const result=await adapter.decide(body,controller.signal);if(!controller.signal.aborted)send(200,result);else fail(504,'timeout','Decision cancelled or timed out');}
   catch(e){const status=e?.statusCode??e?.cause?.statusCode;const code=controller.signal.aborted?'timeout':status===401||status===403?'auth':status===402?'budget':status===429?'busy':'upstream';const messages={timeout:'Время ожидания Jev истекло. Повторите команду.',auth:'Gateway отклонил доступ. Проверьте ключ и разрешения.',budget:'Gateway отклонил запрос по лимиту оплаты.',busy:'Jev занят. Повторите команду немного позже.',upstream:'Jev временно недоступен. Повторите команду.'};fail(controller.signal.aborted?504:502,code,messages[code]);}
   finally{clearTimeout(timer);res.off('close',abort);busy=false;}return;
  }
  if(req.method!=='GET')return fail(405,'method','Method rejected');
  const file=url.pathname==='/'?'controller.html':url.pathname.slice(1);
  if(!files.has(file))return fail(404,'not_found','Not found');
  try{const data=await readFile(path.join(root,file));res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.md')?'text/markdown; charset=utf-8':'text/javascript');res.end(data);}catch{return fail(404,'not_found','Not found');}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const adapter=await createAdapter();const server=createServer({adapter});
 server.listen(47831,'127.0.0.1',()=>console.log('Voice Browser: http://127.0.0.1:47831'));
 server.on('error',()=>{console.error('Local server unavailable. Check port 47831.');process.exitCode=1;});
}
