import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {readCloudProfile,writeCloudProfile,validateCloudProfile} from './profile-store.mjs';
import {createWorker} from './worker.mjs';
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./migrations/0001_profiles.sql',import.meta.url),'utf8'));const wrap=(sql,args=[])=>({bind:(...values)=>wrap(sql,values),first:async()=>sqlite.prepare(sql).get(...args),all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:sqlite.prepare(sql).run(...args).changes}})});return {prepare:sql=>wrap(sql),batch:async stmts=>{sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}},close:()=>sqlite.close()};}
const profile=()=>({version:1,preferences:'More soul',batches:[],ratings:{},keeps:[],requestLog:[]});
test('D1 profile revisions isolate accounts and reject stale writes',async()=>{const db=database();try{assert.equal((await readCloudProfile(db,'a')).profile,null);const first=await writeCloudProfile(db,'a',0,profile());assert.equal(first.revision,1);const conflict=await writeCloudProfile(db,'a',0,{...profile(),preferences:'overwrite'});assert(conflict.conflict);assert.equal(conflict.profile.preferences,'More soul');assert.equal((await readCloudProfile(db,'b')).profile,null);await writeCloudProfile(db,'a',1,{...profile(),preferences:'Updated'});assert.equal((await readCloudProfile(db,'a')).profile.preferences,'Updated');}finally{db.close()}});
test('large Unicode profiles round-trip in safe chunks and retain five revisions',async()=>{const db=database();try{const p=profile();p.known=Array.from({length:7000},(_,i)=>({title:'🎵'.repeat(25)+i,artist:'音楽'}));let revision=0;for(let i=0;i<6;i++)revision=(await writeCloudProfile(db,'a',revision,p)).revision;assert.deepEqual((await readCloudProfile(db,'a')).profile,p);assert.equal((await db.prepare('SELECT COUNT(DISTINCT revision) AS n FROM profile_chunks').first()).n,5);}finally{db.close()}});
test('cloud endpoints use verified Spotify identity and never spend model quota',async()=>{const db=database();try{let identities=0;const worker=createWorker(async(url,options)=>{assert.equal(url,'https://api.spotify.com/v1/me');identities++;return Response.json({id:options.headers.Authorization.split(' ')[1]})});const env={PROFILES:db,ALLOWED_ORIGINS:'https://app.test',ALLOWED_SPOTIFY_USERS:'alice,bob'};const req=(user='alice',method='GET',body,origin='https://app.test')=>new Request('https://backend/profile',{method,headers:{Origin:origin,Authorization:'Bearer '+user,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal((await worker.fetch(req('mallory'),env)).status,403);assert.equal((await worker.fetch(req('alice','GET',null,'https://evil.test'),env)).status,403);const r=await worker.fetch(req('alice','PUT',{revision:0,profile:profile()}),env);assert.equal(r.status,200);assert.equal((await (await worker.fetch(req('alice'),env)).json()).revision,1);assert.equal((await (await worker.fetch(req('bob'),env)).json()).profile,null);assert.equal((await worker.fetch(req('alice','PUT',{revision:1,profile:{...profile(),access_token:'not-allowed'}}),env)).status,400);assert.equal((await worker.fetch(req('alice','PUT',{userId:'bob',revision:1,profile:profile()}),env)).status,400);assert(identities>0);}finally{db.close()}});
test('cloud profile rejects unknown credential/cache fields and oversized snapshots',()=>{assert.throws(()=>validateCloudProfile({...profile(),playlistCache:{}}));assert.throws(()=>validateCloudProfile({...profile(),preferences:'x'.repeat(9*1024*1024)}));});

test('developer usage is owner-only and returns counts without listening or profile data',async()=>{
 const db=database();try{
  const saved={...profile(),preferences:'private preference',batches:[{id:'old',ids:[],created:'2026-01-01T10:00:00Z'},{id:'new',ids:[],created:'2026-02-01T10:00:00Z'}],known:[{title:'Private song',artist:'Private artist'}]};
  await writeCloudProfile(db,'owner',0,saved);await writeCloudProfile(db,'bob',0,profile());
  let checks=0;const worker=createWorker(async(url,options)=>{assert.equal(url,'https://api.spotify.com/v1/me');checks++;return Response.json({id:options.headers.Authorization.split(' ')[1]})});
  const env={PROFILES:db,ALLOWED_ORIGINS:'https://app.test',ALLOWED_SPOTIFY_USERS:'owner,bob,new-user',DEVELOPER_SPOTIFY_USER:'owner'};
  const req=(token='owner')=>new Request('https://backend/developer/usage?userId=owner',{headers:{Origin:'https://app.test',...(token?{Authorization:'Bearer '+token}:{})}});
  assert.equal((await worker.fetch(req(''),env)).status,401);assert.equal(checks,0);
  assert.equal((await worker.fetch(req('bob'),env)).status,403);assert.equal((await worker.fetch(req('mallory'),env)).status,403);
  assert.equal((await worker.fetch(req(),{...env,DEVELOPER_SPOTIFY_USER:undefined})).status,403);
  const r=await worker.fetch(req(),env);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');const data=await r.json();
  assert.deepEqual(data.users.map(x=>[x.userId,x.batchCount]),[['owner',2],['bob',0],['new-user',null]]);
  assert.equal(data.users[0].latestBatch,'2026-02-01T10:00:00Z');assert(data.users[0].lastSyncedAt);
  assert.deepEqual(Object.keys(data.users[0]).sort(),['batchCount','lastSyncedAt','latestBatch','userId']);
  assert(!JSON.stringify(data).includes('Private'));assert(!JSON.stringify(data).includes('preference'));
 }finally{db.close()}
});

test('cloud profiles preserve artist exclusions and reject malformed lists',async()=>{const db=database();try{const p={...profile(),excludedArtists:['Artist A','Artist B']};await writeCloudProfile(db,'a',0,p);assert.deepEqual((await readCloudProfile(db,'a')).profile.excludedArtists,p.excludedArtists);for(const excludedArtists of ['artist',[''],Array(501).fill('artist')])assert.throws(()=>validateCloudProfile({...profile(),excludedArtists}));}finally{db.close()}});

test('older app clients cannot erase artist bans or enter a sync loop on unknown fields',async()=>{
 const db=database();try{
  await writeCloudProfile(db,'alice',0,{...profile(),excludedArtists:['Blocked']});
  const worker=createWorker(async()=>Response.json({id:'alice'})),env={PROFILES:db,ALLOWED_ORIGINS:'https://app.test',ALLOWED_SPOTIFY_USERS:'alice'};
  const req=(method='GET',body,modern=false)=>new Request('https://backend/profile'+(modern?'?artistExclusions=1':''),{method,headers:{Origin:'https://app.test',Authorization:'Bearer alice',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert(!('excludedArtists' in (await (await worker.fetch(req(),env)).json()).profile));
  assert.deepEqual((await (await worker.fetch(req('GET',null,true),env)).json()).profile.excludedArtists,['Blocked']);
  assert.equal((await worker.fetch(req('PUT',{revision:1,profile:profile()}),env)).status,200);
  assert.deepEqual((await readCloudProfile(db,'alice')).profile.excludedArtists,['Blocked']);
  const conflict=await (await worker.fetch(req('PUT',{revision:1,profile:profile()}),env)).json();assert(conflict.conflict);assert(!('excludedArtists' in conflict.profile));
  assert.equal((await worker.fetch(req('PUT',{revision:2,profile:{...profile(),excludedArtists:[]}},true),env)).status,200);
  assert.deepEqual((await readCloudProfile(db,'alice')).profile.excludedArtists,[]);
 }finally{db.close()}
});
