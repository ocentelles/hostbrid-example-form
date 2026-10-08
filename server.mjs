import {createPipeline} from './pipeline.mjs';
import {mocks} from './mock-adapters.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const port=Number(process.env.PORT??8080);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid PORT');
const configuredOrigin=process.env.FORM_ORIGIN;
if(configuredOrigin){const u=new URL(configuredOrigin);if(!['http:','https:'].includes(u.protocol)||u.origin!==configuredOrigin)throw new Error('Invalid FORM_ORIGIN');}
const scenario=process.env.FORM_TEST_MOCK_SCENARIO;
if(scenario&&process.env.NODE_ENV!=='test')throw new Error('Mocks require NODE_ENV=test');
const adapters=scenario?mocks(scenario):null;
const pipeline=adapters?createPipeline(adapters):null;
let allowedOrigin;const buckets=new Map();let accepted=0;
const LIMIT=4096,WINDOW=60000,ATTEMPTS=5,CAP=1024;
const files=new Map();for(const [route,file,type] of [['/','index.html','text/html'],['/form.css','form.css','text/css'],['/form.js','form.js','text/javascript'],['/envelope.svg','envelope.svg','image/svg+xml']])files.set(route,{body:await readFile(new URL('public/'+file,import.meta.url)),type});
function reply(req,res,status,payload,type='application/json'){
 const body=Buffer.isBuffer(payload)?payload:Buffer.from(type==='application/json'?JSON.stringify(payload)+'\n':payload);
 res.writeHead(status,{'content-type':type+'; charset=utf-8','content-length':body.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"});res.end(req.method==='HEAD'?undefined:body);
}
function fail(status,code){return Object.assign(new Error(code),{status,code});}
function budget(ip){const now=Date.now();for(const [key,b] of buckets)if(now-b.start>=WINDOW)buckets.delete(key);let b=buckets.get(ip);if(!b){if(buckets.size>=CAP)return false;b={start:now,count:0};buckets.set(ip,b);}return ++b.count<=ATTEMPTS;}
function body(req){return new Promise((resolve,reject)=>{let size=0,parts=[],done=false;const timer=setTimeout(()=>{if(!done){done=true;parts=[];reject(fail(408,'request_timeout'));req.resume();}},3000);const end=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(Buffer.concat(parts));parts=[];};req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>LIMIT){end(fail(413,'body_too_large'));req.resume();}else parts.push(chunk);});req.on('end',()=>end());req.on('aborted',()=>end(fail(400,'aborted')));req.on('error',()=>end(fail(400,'read_error')));});}
function validate(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!==(pipeline?'challengeToken,email,message,name,website':'email,message,name,website'))throw fail(422,'invalid_fields');
 for(const key of ['name','email','message','website'])if(typeof data[key]!=='string')throw fail(422,'invalid_fields');
 if(data.website!=='')throw fail(422,'invalid_fields');
 const name=data.name.trim(),email=data.email.trim(),message=data.message.trim();
 if(name.length<2||name.length>80||email.length>254||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)||message.length<10||message.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(name+email+message)||/[\r\n]/.test(name+email))throw fail(422,'invalid_fields');
}
const server=http.createServer({headersTimeout:5000,requestTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
 try{
 if(req.url==='/api/contact'){
  if(req.method!=='POST'){res.setHeader('allow','POST');return reply(req,res,405,{error:'method_not_allowed'});}
  if(!budget(req.socket.remoteAddress)){res.setHeader('retry-after','60');req.resume();return reply(req,res,429,{error:'rate_limited'});}
  if(req.headers.origin!==allowedOrigin)throw fail(403,'origin_not_allowed');
  if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')throw fail(403,'origin_not_allowed');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding'])throw fail(415,'unsupported_type');
  if(req.headers['content-length']&&Number(req.headers['content-length'])>LIMIT)throw fail(413,'body_too_large');
  const bytes=await body(req);let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail(400,'invalid_json');}
  validate(data);if(pipeline){const outcome=await pipeline({key:req.headers['idempotency-key'],data,token:data.challengeToken});accepted++;return reply(req,res,200,outcome);}accepted++;return reply(req,res,200,{accepted:true,delivery:'not-sent',receipt:randomUUID()});
 }
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('allow','GET, HEAD');return reply(req,res,405,{error:'method_not_allowed'});}
 if(req.url==='/healthz')return reply(req,res,200,{status:'ok',delivery:'disabled',storage:'ephemeral',accepted});
 const asset=files.get(req.url);if(asset)return reply(req,res,200,asset.body,asset.type);
 return reply(req,res,404,{error:'not_found'});
 }catch(error){req.resume();if(!res.headersSent)reply(req,res,error.status??500,{error:error.code??'internal_error'});}
});
server.keepAliveTimeout=1000;
server.listen(port,'127.0.0.1',()=>{allowedOrigin=configuredOrigin??`http://127.0.0.1:${server.address().port}`;console.log(JSON.stringify({event:'listening',port:server.address().port,origin:allowedOrigin,delivery:'disabled'}));});
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();});
