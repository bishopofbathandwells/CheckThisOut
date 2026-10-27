import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker,RecommendationBudget,LIMITS,tokenUsage,generateCandidates} from './worker.mjs';
import {selectDiscoveries} from '../discovery.js';

class Storage {
 data=new Map();queue=Promise.resolve();
 async get(k){return structuredClone(this.data.get(k))}
 async put(k,v){this.data.set(k,structuredClone(v))}
 async transaction(fn){const previous=this.queue;let release;this.queue=new Promise(resolve=>release=resolve);await previous;try{return await fn(this)}finally{release()}}
}
function setup({users=['alice'],modelStatus=200,modelData,delay=0,storage=new Storage()}={}){
 const env={ENABLED:'true',OPENAI_API_KEY:'test-secret-not-real',OPENAI_MODEL:'gpt-6-luna',ALLOWED_SPOTIFY_USERS:users.join(','),ALLOWED_ORIGINS:'http://127.0.0.1:8766'};
 let calls=0,identities=0,lastBody;
 let songs=Array.from({length:12},(_,i)=>({title:`Song ${i}`,artist:`Artist ${i}`}));
 const fetcher=async(url,options)=>{
  if(url==='https://api.spotify.com/v1/me'){identities++;const token=options.headers.Authorization.split(' ')[1];return token==='invalid'?new Response('',{status:401}):Response.json({id:token})}
  assert.equal(url,'https://api.openai.com/v1/responses');calls++;lastBody=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer test-secret-not-real');
  songs=Array.from({length:lastBody.text.format.schema.properties.songs.minItems},(_,i)=>({title:`Song ${i}`,artist:`Artist ${i}`}));
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  return Response.json(modelData||{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({songs})}]}]},{status:modelStatus});
 };
 const durable=new RecommendationBudget({storage},env,fetcher);
 env.BUDGET={idFromName:name=>name,get:()=>durable};
 const worker=createWorker(fetcher);
 const req=(user='alice',body={requestId:crypto.randomUUID(),preferences:'More soul, less jazz'},origin='http://127.0.0.1:8766')=>new Request('https://worker.example/recommend',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${user}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {env,worker,req,storage,get calls(){return calls},get identities(){return identities},get body(){return lastBody}};
}
test('allowed identity gets structured candidates; model gets bounded context without identity or credentials',async()=>{
 const s=setup(),response=await s.worker.fetch(s.req(),s.env);assert.equal(response.status,200);assert.equal((await response.json()).songs.length,12);assert.equal(s.calls,1);
 assert.equal(s.body.model,'gpt-6-luna');assert.equal(s.body.store,false);assert.deepEqual(s.body.reasoning,{effort:'low'});assert.equal(s.body.max_output_tokens,LIMITS.outputTokens);assert.equal(s.body.text.format.strict,true);
 assert.deepEqual(JSON.parse(s.body.input),{listener_preferences:'More soul, less jazz',playlist_tracks:[],excluded_tracks:[]});assert(!JSON.stringify(s.body).includes('test-secret'));assert(!JSON.stringify(s.body).includes('alice'));
});
test('CORS, login, allowlist, disabled config and arbitrary payloads fail before model',async()=>{
 const s=setup();assert.equal((await s.worker.fetch(s.req('alice',undefined,'https://evil.example'),s.env)).status,403);
 assert.equal((await s.worker.fetch(s.req('invalid'),s.env)).status,401);
 assert.equal((await s.worker.fetch(s.req('mallory'),s.env)).status,403);
 assert.equal((await s.worker.fetch(s.req('alice',{requestId:crypto.randomUUID(),preferences:'x',model:'expensive',history:[]}),s.env)).status,400);
 assert.equal((await s.worker.fetch(s.req('alice',{requestId:crypto.randomUUID(),preferences:'x'.repeat(1201)}),s.env)).status,400);
 assert.equal((await s.worker.fetch(s.req('alice',{requestId:crypto.randomUUID(),preferences:'x'.repeat(LIMITS.bodyBytes+1)}),s.env)).status,413);
 s.env.ENABLED='false';assert.equal((await s.worker.fetch(s.req(),s.env)).status,503);assert.equal(s.calls,0);
});
test('same request is cached and different preferences cannot reuse its ID',async()=>{
 const s=setup(),input={requestId:crypto.randomUUID(),preferences:'funk'};
 assert.equal((await s.worker.fetch(s.req('alice',input),s.env)).status,200);
 assert.equal((await s.worker.fetch(s.req('alice',input),s.env)).status,200);assert.equal(s.calls,1);
 assert.equal((await s.worker.fetch(s.req('alice',{...input,preferences:'jazz'}),s.env)).status,409);assert.equal(s.calls,1);
});
test('100 per account per UTC day, persisted across restarts; cached retries do not count',async()=>{
 const s=setup({users:['alice','bob']}),input={requestId:crypto.randomUUID(),preferences:'soul'};
 assert.equal((await s.worker.fetch(s.req('alice',input),s.env)).status,200);
 for(let i=1;i<100;i++)assert.equal((await s.worker.fetch(s.req(),s.env)).status,200);
 assert.equal((await s.worker.fetch(s.req('alice',input),s.env)).status,200);assert.equal(s.calls,100);
 const restarted=setup({storage:s.storage});assert.equal((await restarted.worker.fetch(restarted.req(),restarted.env)).status,429);assert.equal(restarted.calls,0);
 assert.equal((await s.worker.fetch(s.req('bob'),s.env)).status,200);
 const r=await s.worker.fetch(new Request('https://worker.example/usage',{headers:{Origin:'http://127.0.0.1:8766',Authorization:'Bearer alice'}}),s.env);const usage=await r.json();assert.equal(usage.limit,100);assert.equal(usage.remaining,0);
 await s.storage.put('daily:alice',{day:'2000-01-01',used:100});assert.equal((await s.worker.fetch(s.req(),s.env)).status,200);
});
test('sizes 1 and 10 produce enough candidates; invalid sizes and reused ID changes fail',async()=>{
 const s=setup();for(const batchSize of [1,10]){const input={requestId:crypto.randomUUID(),preferences:'soul',batchSize};const r=await s.worker.fetch(s.req('alice',input),s.env);assert.equal(r.status,200);const data=await r.json();assert.equal(data.songs.length,Math.max(12,batchSize*2));const tracks=await selectDiscoveries(data.songs,[],async t=>({...t,uri:t.title}),batchSize);assert.equal(tracks.length,batchSize);assert(tracks.every(t=>t.color));assert.equal((await s.worker.fetch(s.req('alice',{...input,batchSize:5}),s.env)).status,409);}
 for(const batchSize of [0,11,1.5,'10'])assert.equal((await s.worker.fetch(s.req('alice',{requestId:crypto.randomUUID(),preferences:'',batchSize}),s.env)).status,400);
});
test('parallel requests for one user cannot double charge',async()=>{
 const s=setup({delay:20});const results=await Promise.all(Array.from({length:12},()=>s.worker.fetch(s.req(),s.env)));
 assert.equal(s.calls,1);assert.equal(results.filter(r=>r.status===409).length,11);
});
test('upstream errors release concurrency and are cached without exposing provider details',async()=>{
 const s=setup({modelStatus:500,modelData:{error:'test-secret-not-real'}}),input={requestId:crypto.randomUUID(),preferences:'soul'};
 const result=await s.worker.fetch(s.req('alice',input),s.env);assert.equal(result.status,502);assert(!(await result.text()).includes('test-secret'));
 assert.equal((await s.worker.fetch(s.req('alice',input),s.env)).status,502);assert.equal(s.calls,1);assert.equal((await s.storage.get('pending:alice')).started,0);assert.equal((await s.storage.get('daily:alice')).used,0);
});
test('storage failure fails closed before spending',async()=>{
 const s=setup({storage:{transaction:async()=>{throw Error('storage down')}}});assert.equal((await s.worker.fetch(s.req(),s.env)).status,503);assert.equal(s.calls,0);
});
test('model refusals, incomplete responses, malformed and duplicate songs are rejected',async()=>{
 for(const data of [{status:'incomplete'},{status:'completed',output:[]},{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({songs:Array(12).fill({title:'Same',artist:'Same'})})}]}]}]){
  const s=setup({modelData:data});assert.equal((await s.worker.fetch(s.req(),s.env)).status,502);
 }
});
test('old allowance ledger is ignored, health is safe, preflight does not spend',async()=>{
 const s=setup();await s.storage.put('ledger',{day:'2000-01-01',total:25,users:{alice:5},entries:{}});
 assert.equal((await s.worker.fetch(s.req(),s.env)).status,200);
 const health=await s.worker.fetch(new Request('https://worker.example/health',{headers:{Origin:'http://127.0.0.1:8766'}}),s.env);assert.equal((await health.json()).ready,true);
 const preflight=await s.worker.fetch(new Request('https://worker.example/recommend',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:8766'}}),s.env);assert.equal(preflight.status,204);assert.equal(s.calls,1);
});
test('selection removes known names, URIs, same-recording variants, duplicates and unmatched candidates',async()=>{
 const candidates=Array.from({length:12},(_,i)=>({artist:'Artist',title:'Song '+i}));
 const tracks=await selectDiscoveries(candidates,[{artist:'Artist',title:'Song 0'},{uri:'uri1',artist:'Other',title:'Other',isrc:'isrc2'}],async t=>{
  const i=Number(t.title.split(' ')[1]);if(i===3)throw Error('No exact Spotify match');return {...t,uri:'uri'+(i===5?4:i),isrc:'isrc'+i};
 });
 assert.deepEqual(tracks.map(t=>t.title),['Song 4','Song 6','Song 7','Song 8','Song 9']);
 await assert.rejects(()=>selectDiscoveries(candidates,[],async()=>{throw Error('Spotify rate limit reached')}),/rate limit/);
});

test('playlist context reaches model and participates in cached-request identity',async()=>{
 const s=setup(),input={requestId:crypto.randomUUID(),preferences:'More obscure',batchSize:10,playlistTracks:[{title:'Pink Moon',artist:'Nick Drake'}]};
 assert.equal((await s.worker.fetch(s.req('alice',input),s.env)).status,200);assert.deepEqual(JSON.parse(s.body.input).playlist_tracks,input.playlistTracks);assert(!JSON.stringify(s.body).includes('spotify:'));
 assert.equal((await s.worker.fetch(s.req('alice',{...input,playlistTracks:[]}),s.env)).status,409);assert.equal(s.calls,1);
 for(const playlistTracks of [Array(201).fill({title:'Song',artist:'Artist'}),[{title:'Song',artist:'Artist',token:'private'}],[{title:'',artist:'Artist'}],[{title:'x'.repeat(121),artist:'Artist'}]])assert.equal((await s.worker.fetch(s.req('alice',{...input,requestId:crypto.randomUUID(),playlistTracks}),s.env)).status,400);
});

test('growing exclusions reach the model, validated and included in retry identity',async()=>{
 const s=setup(),exclusions=Array.from({length:500},(_,i)=>({title:`Old song ${i}`,artist:'Kano'})),input={requestId:crypto.randomUUID(),preferences:'',exclusions};
 assert.equal((await s.worker.fetch(s.req('alice',input),s.env)).status,200);assert.deepEqual(JSON.parse(s.body.input).excluded_tracks,exclusions);
 assert.equal((await s.worker.fetch(s.req('alice',{...input,exclusions:[]}),s.env)).status,409);
 for(const exclusions of [[{title:'x',artist:'y',token:'secret'}],Array(10001).fill({title:'x',artist:'y'})])assert.equal((await s.worker.fetch(s.req('alice',{...input,requestId:crypto.randomUUID(),exclusions}),s.env)).status,400);
});
test('reported token usage produces cached-input-aware USD estimates, without inventing missing usage',()=>{
 const result={model:'gpt-6-luna',usage:{input_tokens:10000,output_tokens:1000,input_tokens_details:{cached_tokens:2000},total_tokens:11000}};
 assert.equal(tokenUsage(result,'gpt-6-luna').estimatedCostUsd,0.00132);assert.equal(tokenUsage({},'gpt-6-luna'),null);assert.equal(tokenUsage(result,'other-model').estimatedCostUsd,null);
});
test('incomplete paid responses retain usage and cached retries never call model twice',async()=>{
 const s=setup({modelData:{status:'incomplete',usage:{input_tokens:1000,output_tokens:3000,total_tokens:4000}}}),input={requestId:crypto.randomUUID(),preferences:''};
 const r=await s.worker.fetch(s.req('alice',input),s.env);assert.equal(r.status,502);assert.equal((await r.json()).usage.totalTokens,4000);
 const cached=await s.worker.fetch(s.req('alice',input),s.env);const data=await cached.json();assert.equal(data.cached,true);assert.equal(data.usage.totalTokens,4000);assert.equal(s.calls,1);
});

test('model network failures and malformed connection responses return actionable diagnostics, without automatic retries',async()=>{
 for(const [fetcher,code]of [[async()=>{throw TypeError('network disconnected')},'MODEL_NETWORK_ERROR'],[async()=>new Response('incomplete-json'),'MODEL_INVALID_RESPONSE']]){
 let calls=0;await assert.rejects(()=>generateCandidates('',{OPENAI_MODEL:'gpt-6-luna',OPENAI_API_KEY:'mock'},async(...args)=>{calls++;return fetcher(...args)}),error=>error.errorCode===code&&error.status===502&&error.elapsedMs>=0&&!error.message.includes('mock'));assert.equal(calls,1);
 }
 assert.equal(LIMITS.modelTimeoutMs,90000);
});
test('timeout is identified separately from network failures without automatic retry',async()=>{
 const previous=LIMITS.modelTimeoutMs;LIMITS.modelTimeoutMs=5;let calls=0;
 try{await assert.rejects(()=>generateCandidates('',{OPENAI_MODEL:'gpt-6-luna',OPENAI_API_KEY:'mock'},async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(new Response('{}')),50);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason)},{once:true})})}),e=>e.errorCode==='MODEL_TIMEOUT'&&e.status===504&&e.elapsedMs>=0);assert.equal(calls,1);}finally{LIMITS.modelTimeoutMs=previous}
});

test('cached candidate retrieval is account-isolated and never creates model calls or quota use',async()=>{
 const s=setup({users:['alice','bob']}),input={requestId:crypto.randomUUID(),preferences:'soul'};await s.worker.fetch(s.req('alice',input),s.env);
 const read=user=>s.worker.fetch(new Request('https://worker.example/result?requestId='+input.requestId,{headers:{Origin:'http://127.0.0.1:8766',Authorization:'Bearer '+user}}),s.env);
 const cached=await read('alice');assert.equal(cached.status,200);assert.equal((await cached.json()).songs.length,12);assert.equal((await read('bob')).status,404);assert.equal((await read('mallory')).status,403);assert.equal(s.calls,1);assert.equal((await s.storage.get('daily:alice')).used,1);
});
