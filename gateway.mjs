import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {experimental_evaluate as evaluate} from 'ai';
import {createGateway} from '@ai-sdk/gateway';
export const MODEL='typesafe-ai/jev';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const short=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n;
export function validateInput(body){
 if(!plain(body)||Object.keys(body).some(k=>!['state','questions'].includes(k)))throw Error('schema');
 const s=body.state,q=body.questions;
 if(!plain(s)||!short(s.user_command,1200)||!plain(s.compact_page_state)||!Array.isArray(s.compact_page_state.elements)||s.compact_page_state.elements.length>251)throw Error('schema');
 if(JSON.stringify(s).length>48000)throw Error('limit');
 const ids=new Set();for(const e of s.compact_page_state.elements){if(!plain(e)||!/^e\d{1,5}$/.test(e.id)||ids.has(e.id)||!short(e.label,500)||!short(e.kind,40))throw Error('element');ids.add(e.id);}
 if(!plain(q)||Object.keys(q).length!==1||!plain(q.action)||q.action.type!=='choice'||!short(q.action.instructions,2000)||!plain(q.action.criteria))throw Error('question');
 if(Object.keys(q.action).some(k=>!['type','instructions','criteria'].includes(k)))throw Error('question');
 const entries=Object.entries(q.action.criteria);if(entries.length<2||entries.length>255||!Object.hasOwn(q.action.criteria,'none'))throw Error('criteria');
 if(Object.hasOwn(q.action.criteria,'navigate')){const label=q.action.criteria.navigate;if(typeof label!=='string'||!label.startsWith('Open URL '))throw Error('navigate');const url=new URL(label.slice(9));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('navigate');}
 for(const [id,label]of entries)if(!(ids.has(id)||['scroll_down','scroll_up','back','navigate','none'].includes(id))||!short(label,600))throw Error('criteria');
}
export function normalizeResult(result,questions,decisionMs){
 const a=result.answers?.action;if(!a||a.type!=='choice'||!Object.hasOwn(questions.action.criteria,a.choice))throw Error('invalid response');
 const out={type:'choice',choice:a.choice};
 if(a.probabilities!==undefined){if(!plain(a.probabilities))throw Error('invalid probabilities');out.probabilities={};for(const [k,v]of Object.entries(a.probabilities)){if(!Object.hasOwn(questions.action.criteria,k)||!Number.isFinite(v)||v<0||v>1)throw Error('invalid probabilities');out.probabilities[k]=v;}}
 const confidence=result.providerMetadata?.typesafe?.confidence?.action;if(Number.isFinite(confidence)&&confidence>=0&&confidence<=1)out.confidence=confidence;
 const usage=Object.fromEntries(['inputTokens','outputTokens','totalTokens'].map(k=>[k,Number.isFinite(result.usage?.[k])&&result.usage[k]>=0?result.usage[k]:null]));
 const decimals=result.rounding?.probabilityDecimals;const rounding=Number.isInteger(decimals)&&decimals>=0&&decimals<=15?{probabilityDecimals:decimals}:undefined;
 return {model:MODEL,answers:{action:out},usage,decisionMs:Math.round(decisionMs),...(rounding?{rounding}:{})};
}
export async function createAdapter({apiKey,evaluateFn=evaluate}={}){
 if(apiKey===undefined){apiKey=process.env.AI_GATEWAY_API_KEY; if(!apiKey&&process.env.GATEWAY_KEY_FILE){try{apiKey=(await readFile(process.env.GATEWAY_KEY_FILE,'utf8')).trim();}catch{apiKey='';}}}
 const configured=typeof apiKey==='string'&&apiKey.trim().length>0;
 const model=configured?createGateway({apiKey}).evaluationModel(MODEL):null;
 return {configured,async decide(body,signal){validateInput(body);if(!configured)throw Error('unconfigured');const start=performance.now();const result=await evaluateFn({model,state:body.state,questions:body.questions,maxRetries:0,abortSignal:signal,providerOptions:process.env.JEV_ZERO_DATA_RETENTION==='1'?{gateway:{zeroDataRetention:true}}:{}});signal?.throwIfAborted();return normalizeResult(result,body.questions,performance.now()-start);}};
}
