import test from 'node:test';import assert from 'node:assert/strict';import {createWorker} from './worker.mjs';
const id='a'.repeat(22),origin='https://app.test';
function rig({status=200,body,plain=false,network=false,identityStatus=200}={}){
 const calls=[];const worker=createWorker(async(url,options)=>{calls.push({url,options});if(url==='https://api.spotify.com/v1/me')return identityStatus===200?Response.json({id:options.headers.Authorization.split(' ')[1]}):new Response('',{status:identityStatus});
  assert(url.startsWith('https://api.spotify.com/v1/playlists/'+id+'/items?'));assert.equal(options.headers.Authorization,'Bearer alice');assert.equal(options.redirect,'error');if(network)throw Error('private server error');
  const data=body??{items:[{item:{uri:'spotify:track:'+id,name:'Song',artists:[{name:'Artist',id:'not-needed'}],type:'track',external_ids:{isrc:'TEST'},preview_url:'private-extra',album:{images:['not-needed']}},added_by:{id:'private-person'}},{item:null}],next:'https://api.spotify.com/private-next'};
  return plain?new Response('private upstream response',{status}):Response.json(data,{status,headers:status===429?{'Retry-After':'120'}:{}});
 });const env={ALLOWED_ORIGINS:origin,ALLOWED_SPOTIFY_USERS:'alice'};
 const req=(query='playlistId='+id,token='alice',method='GET',from=origin)=>new Request('https://backend/spotify/playlist-items?'+query,{method,headers:{Origin:from,...(token?{Authorization:'Bearer '+token}:{})}});
 return {worker,env,req,calls};
}
test('playlist proxy authenticates and permits only bounded playlist GETs',async()=>{
 const r=rig();assert.equal((await r.worker.fetch(r.req(undefined,''),r.env)).status,401);assert.equal(r.calls.length,0);
 assert.equal((await r.worker.fetch(r.req(undefined,'mallory'),r.env)).status,403);assert.equal(r.calls.length,1);
 assert.equal((await r.worker.fetch(r.req(undefined,'alice','GET','https://wrong.test'),r.env)).status,403);
 const before=r.calls.length;for(const query of ['url=https://evil.test','playlistId=../me','playlistId='+id+'&offset=-1','playlistId='+id+'&offset=100001','playlistId='+id+'&limit=51','playlistId='+id+'&limit=0','playlistId='+id+'&market=US','playlistId='+id+'&playlistId='+id])assert.equal((await r.worker.fetch(r.req(query),r.env)).status,400,query);assert.equal(r.calls.length,before);
 assert.equal((await r.worker.fetch(r.req(undefined,'alice','POST'),r.env)).status,404);assert.equal(r.calls.length,before);
});
test('playlist proxy returns minimal track metadata, fixed host and correct pagination without model calls',async()=>{
 const r=rig(),response=await r.worker.fetch(r.req('playlistId='+id+'&offset=50&limit=50'),r.env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const data=await response.json();assert.equal(data.spotifyStatus,200);assert(data.spotifyProxy);assert(data.body.next);assert.equal(data.body.items.length,2);assert.equal(data.body.items[0].item.name,'Song');assert.equal(data.body.items[1].item,null);
 const serialized=JSON.stringify(data);for(const excluded of ['private-person','private-extra','not-needed','private-next','Bearer'])assert(!serialized.includes(excluded));assert.equal(r.calls.length,2);const url=new URL(r.calls[1].url);assert.equal(url.searchParams.get('offset'),'50');assert.equal(url.searchParams.get('limit'),'50');
});
test('playlist proxy preserves actual access, missing, token and quota statuses, including non-JSON errors',async()=>{
 for(const status of [401,403,404,429,500]){const r=rig({status,body:{error:{reason:'QUOTA_EXCEEDED',message:'private original message'}}}),data=await (await r.worker.fetch(r.req(),r.env)).json();assert.equal(data.spotifyStatus,status);assert(!JSON.stringify(data).includes('private original'));assert.equal(data.body.error.reason,'QUOTA_EXCEEDED');if(status===429)assert.equal(data.retryAfter,'120');}
 const r=rig({status:403,plain:true});assert.equal((await (await r.worker.fetch(r.req(),r.env)).json()).spotifyStatus,403);
});
test('playlist proxy fails safely on network/malformed pages and identity rate limits',async()=>{
 for(const options of [{network:true},{plain:true},{body:{items:'invalid'}},{body:{items:Array(51).fill(null)}}]){const r=rig(options),response=await r.worker.fetch(r.req(),r.env);assert.equal(response.status,502);assert(!(await response.text()).includes('private'));}
 const r=rig({identityStatus:429}),response=await r.worker.fetch(r.req(),r.env);assert.equal(response.status,429);assert.equal(r.calls.length,1);assert((await response.json()).retryAt>Date.now());
});
