import test from 'node:test';import assert from 'node:assert/strict';import {CloudProfileSync,canonicalProfile,stampProfileChanges,mergeProfiles} from './cloud-sync.js';
const blank=()=>({version:1,preferences:'',batches:[],ratings:{},keeps:[]});
function rig(){let remote={revision:0,profile:null},offline=false;const clients=[];function device(initial=blank()){let local=structuredClone(initial),observed=structuredClone(initial),meta={},status;const c=new CloudProfileSync({getProfile:()=>structuredClone(local),applyProfile:async p=>{local=structuredClone(p);observed=structuredClone(local)},request:async(method,body)=>{if(offline)throw Error('offline');if(method==='GET')return structuredClone(remote);if(body.revision!==remote.revision)return {conflict:true,...structuredClone(remote)};remote={revision:remote.revision+1,profile:structuredClone(body.profile),updatedAt:new Date().toISOString()};return {revision:remote.revision,updatedAt:remote.updatedAt}},loadMeta:async()=>structuredClone(meta),saveMeta:async p=>{meta=structuredClone(p)},validate:p=>p?.version===1,onStatus:s=>{status=s}});const sync=c.sync.bind(c);c.sync=async choice=>{local.syncEdits=stampProfileChanges(observed,local);observed=structuredClone(local);return sync(choice)};clients.push(c);return {c,get local(){return local},get meta(){return meta},get status(){return status}}}return {device,get remote(){return remote},set offline(v){offline=v},stop:()=>clients.forEach(c=>c.stop())};}
test('cloud sync uploads existing profile, restores a new device, and propagates ratings',async()=>{const r=rig();try{const a=r.device({...blank(),batches:[{id:'batch',ids:['song']}]});await a.c.sync();const b=r.device();await b.c.sync();assert.equal(b.local.batches.length,1);b.local.ratings.song=5;await b.c.sync();await a.c.sync();assert.equal(a.local.ratings.song,5);}finally{r.stop()}});
test('offline edits and concurrent preferences merge automatically',async()=>{const r=rig();try{const a=r.device({...blank(),preferences:'original'}),b=r.device();await a.c.sync();await b.c.sync();r.offline=true;a.local.keeps.push('a');await a.c.sync();assert.equal(a.local.keeps[0],'a');r.offline=false;b.local.preferences='remote edit';await b.c.sync();await a.c.sync();assert(!a.status.conflict);assert.equal(a.local.preferences,'remote edit');assert.deepEqual(r.remote.profile.keeps,['a']);await b.c.sync();assert.deepEqual(b.local.keeps,['a']);}finally{r.stop()}});
test('independent legacy histories combine and cloud preferences survive migration',async()=>{const r=rig();try{const a=r.device({...blank(),preferences:'phone',batches:[{id:'a',ids:['a'],created:'2026-01-01'}]});await a.c.sync();const b=r.device({...blank(),preferences:'desktop',batches:[{id:'b',ids:['b'],created:'2026-01-02'}]});await b.c.sync();assert(!b.status.conflict);assert.equal(b.local.preferences,'phone');assert.deepEqual(b.local.batches.map(x=>x.id),['a','b']);await a.c.sync();assert.deepEqual(a.local.batches,b.local.batches);}finally{r.stop()}});
test('unchanged local persistence does not generate cloud traffic',async()=>{const r=rig();try{const a=r.device();await a.c.sync();const rev=r.remote.revision;await a.c.sync('changes');assert.equal(r.remote.revision,rev);assert.equal(canonicalProfile({b:2,a:1}),canonicalProfile({a:1,b:2}));}finally{r.stop()}});

test('last edit wins per rating and preference, independent edits survive, and keeps can be removed',()=>{
 const base={...blank(),ratings:{a:3,b:3},keeps:['a']};
 const a=structuredClone(base);a.ratings.a=5;a.preferences='less jazz';a.keeps=[];a.syncEdits=stampProfileChanges(base,a,1000);
 const b=structuredClone(base);b.ratings.a=2;b.ratings.b=4;b.batchSize=10;b.keeps.push('b');b.syncEdits=stampProfileChanges(base,b,2000);
 const merged=mergeProfiles(a,b);assert.deepEqual(merged.ratings,{a:2,b:4});assert.equal(merged.preferences,'less jazz');assert.equal(merged.batchSize,10);assert.deepEqual(merged.keeps,['b']);
 assert.deepEqual(mergeProfiles(merged,a),merged);assert.deepEqual(mergeProfiles(merged,b),merged);
});
test('removed songs never return in stale batches and exclusions accumulate',()=>{
 const a={...blank(),batches:[{id:'a',created:'2026-01-01',ids:['x','y'],originalIds:['x','y']}],nukedIds:['x'],recommendedIds:['x','y'],known:[{title:'Known',artist:'A'}]};
 const b={...blank(),batches:[{id:'b',created:'2026-01-02',ids:['z']}],recommendedIds:['z'],known:[{title:'Other',artist:'B'}]};
 const m=mergeProfiles(a,b);assert.deepEqual(m.batches.find(x=>x.id==='a').ids,['y']);assert.deepEqual(m.recommendedIds,['x','y','z']);assert.equal(m.known.length,2);assert.deepEqual(mergeProfiles(m,b),m);
});
test('edits made during an upload are retained for the next sync',async()=>{
 let local={...blank(),preferences:'first'},meta={},remote={revision:0,profile:null};let upload=0;
 const c=new CloudProfileSync({getProfile:()=>structuredClone(local),applyProfile:async p=>{local=p},loadMeta:async()=>meta,saveMeta:async p=>{meta=p},validate:()=>true,request:async(method,body)=>{
 if(method==='GET')return remote;remote={revision:++upload,profile:body.profile};if(upload===1){const previous=structuredClone(local);local.preferences='during upload';local.syncEdits=stampProfileChanges(previous,local);}
 return {revision:upload};}});
 try{await c.sync();assert.equal(local.preferences,'during upload');await c.sync();assert.equal(remote.profile.preferences,'during upload');}finally{c.stop();}
});

test('artist bans combine across devices and removing a ban wins over a stale device',()=>{
 const base={...blank(),excludedArtists:['First']};const a=structuredClone(base);a.excludedArtists.push('Second');a.syncEdits=stampProfileChanges(base,a,1000);
 const b=structuredClone(base);b.excludedArtists=[];b.syncEdits=stampProfileChanges(base,b,2000);
 const combined=mergeProfiles(a,b);assert.deepEqual(combined.excludedArtists,['Second']);assert.deepEqual(mergeProfiles(combined,a).excludedArtists,['Second']);
});
