import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const problem=(status,code)=>Object.assign(new Error(code),{status,code});
async function bounded(fn,arg,timeoutMs){const controller=new AbortController();let timer;try{return await Promise.race([Promise.resolve().then(()=>fn({...arg,signal:controller.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(problem(504,'upstream_timeout'));},timeoutMs);})]);}finally{clearTimeout(timer);}}
export function createPipeline({verify,deliver,timeoutMs=100,now=Date.now,ttlMs=300000,maxEntries=256}){
 if(typeof verify!=='function'||typeof deliver!=='function')throw new Error('Adapters required');
 const entries=new Map(),tokens=new Map();
 function prune(){const time=now();for(const [key,e]of entries)if(!e.pending&&time-e.created>=ttlMs)entries.delete(key);for(const [key,e]of tokens)if(!e.pending&&time-e.created>=ttlMs)tokens.delete(key);}
 return async({key,data,token})=>{
  if(typeof key!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key))throw problem(400,'invalid_idempotency_key');
  if(typeof token!=='string'||token.length<1||token.length>2048)throw problem(422,'invalid_challenge');
  prune();const signature=hash(JSON.stringify([data.name,data.email,data.message,token]));const prior=entries.get(key);
  if(prior){if(prior.signature!==signature)throw problem(409,'idempotency_conflict');return prior.promise;}
  if(entries.size>=maxEntries||tokens.size>=maxEntries)throw problem(503,'pipeline_capacity');
  const tokenKey=hash(token);if(tokens.has(tokenKey))throw problem(409,'challenge_replay');
  const item={created:now(),signature,pending:true},reservation={created:now(),pending:true};entries.set(key,item);tokens.set(tokenKey,reservation);
  item.promise=(async()=>{try{
   let checked;try{checked=await bounded(verify,{token},timeoutMs);}catch(error){throw error.code==='upstream_timeout'?error:problem(503,'verifier_unavailable');}
   if(checked?.success!==true||checked?.hostname!=='local.test'||checked?.action!=='contact')throw problem(403,'challenge_rejected');
   let sent;try{sent=await bounded(deliver,{data,idempotencyKey:key},timeoutMs);}catch(error){throw error.code==='upstream_timeout'?error:problem(503,'delivery_unavailable');}
   if(sent?.accepted!==true||sent?.mode!=='mock')throw problem(503,'delivery_unavailable');
   return {accepted:true,delivery:'not-sent',verification:'mock-only',providerAcceptance:'mock-only'};
  }finally{item.pending=false;reservation.pending=false;}})();
  return item.promise;
 };
}
