// In-process synthetic adapters: no sockets, provider calls, secrets or mail.
export function mocks(scenario='ok'){
 const allowed=['ok','deny','hostname','action','verifier-error','verifier-timeout','delivery-error','delivery-timeout','delivery-malformed'];if(!allowed.includes(scenario))throw new Error('Unknown mock scenario');
 const counts={verify:0,deliver:0};
 function pending(signal){return new Promise((_,reject)=>{if(signal.aborted)return reject(new Error('aborted'));signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}
 return {counts,async verify({signal}){counts.verify++;if(scenario==='verifier-error')throw new Error('Synthetic failure');if(scenario==='verifier-timeout')return pending(signal);return {success:scenario!=='deny',hostname:scenario==='hostname'?'wrong.test':'local.test',action:scenario==='action'?'wrong':'contact'};},async deliver({signal}){counts.deliver++;if(scenario==='delivery-error')throw new Error('Synthetic failure');if(scenario==='delivery-timeout')return pending(signal);return scenario==='delivery-malformed'?{accepted:true}:{accepted:true,mode:'mock'};}};
}
