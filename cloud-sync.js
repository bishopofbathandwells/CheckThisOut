import {normalizeArtist} from './discovery.js';
export function canonicalProfile(value){if(Array.isArray(value))return '['+value.map(canonicalProfile).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalProfile(value[k])).join(',')+'}';return JSON.stringify(value);}
export function hasProfileData(p){return !!(p.batches?.length||p.keeps?.length||Object.keys(p.ratings||{}).length||p.requestLog?.length||p.preferences||p.appName&&p.appName!=='Hidden Gems'||p.theme&&p.theme!=='precision'||p.alsoLike===false);}
// Only user-editable values need clocks; collections retain their stable IDs.
const fields=['preferences','batchSize','alsoLike','appName','theme','keepPlaylistId'];
const key=(kind,id)=>JSON.stringify([kind,id]);
const entries=p=>{
 const out=new Map(fields.map(f=>[key('field',f),p[f]]));
 for(const [id,value] of Object.entries(p.ratings||{}))out.set(key('rating',id),value);
 for(const name of p.excludedArtists||[])out.set(key('excludedArtist',normalizeArtist(name)),name);
 for(const id of p.keeps||[])out.set(key('keep',id),true);
 for(const b of p.batches||[])out.set(key('batch',b.id),b);
 for(const r of p.requestLog||[])out.set(key('log',r.requestId),r);
 return out;
};
export function stampProfileChanges(previous,current,now=Date.now()){
 const before=entries(previous),after=entries(current),edits={...(previous.syncEdits||{}),...(current.syncEdits||{})};
 const stamp=String(Object.values(edits).reduce((n,v)=>Math.max(n,Number(String(v).split(':')[0])||0),now)+1).padStart(16,'0')+':'+crypto.randomUUID();
 for(const k of new Set([...before.keys(),...after.keys()]))if(canonicalProfile(before.get(k))!==canonicalProfile(after.get(k)))edits[k]=stamp;
 return edits;
}
const union=(a=[],b=[])=>[...new Set([...a,...b])].sort();
export function mergeProfiles(local,remote){
 const edits={...remote.syncEdits};
 for(const [k,v] of Object.entries(local.syncEdits||{}))if(v>(edits[k]||''))edits[k]=v;
 const pick=(kind,id,a,b)=>{
  const k=key(kind,id),lc=local.syncEdits?.[k]||'',rc=remote.syncEdits?.[k]||'';
  if(lc!==rc)return lc>rc?a:b;
  if(a===undefined)return b;if(b===undefined)return a;
  // Legacy profiles lack edit times: keep the cloud preference, union collections.
  return !lc?b:canonicalProfile(a)>canonicalProfile(b)?a:b;
 };
 const merged={...remote,version:1,syncEdits:edits};
 for(const f of fields){const v=pick('field',f,local[f],remote[f]);if(v!==undefined)merged[f]=v;else delete merged[f];}
 merged.ratings={};for(const id of union(Object.keys(local.ratings||{}),Object.keys(remote.ratings||{}))){const v=pick('rating',id,local.ratings?.[id],remote.ratings?.[id]);if(v!==undefined)merged.ratings[id]=v;}
 const lk=new Set(local.keeps||[]),rk=new Set(remote.keeps||[]);
 merged.keeps=union([...lk],[...rk]).filter(id=>pick('keep',id,lk.has(id)?true:undefined,rk.has(id)?true:undefined));
 for(const f of ['recommendedIds','nukedIds','keepNeedsSync'])merged[f]=union(local[f],remote[f]);
 merged.keepNeedsSync=merged.keepNeedsSync.filter(id=>merged.keeps.includes(id));
 const la=new Map((local.excludedArtists||[]).map(a=>[normalizeArtist(a),a])),ra=new Map((remote.excludedArtists||[]).map(a=>[normalizeArtist(a),a]));
 merged.excludedArtists=union([...la.keys()],[...ra.keys()]).map(id=>pick('excludedArtist',id,la.get(id),ra.get(id))).filter(Boolean);
 merged.tracks={...local.tracks,...remote.tracks};
 for(const f of ['known','userKnown']){const map=new Map();for(const t of [...(local[f]||[]),...(remote[f]||[])])map.set(t.uri||JSON.stringify([t.artist,t.title]),t);merged[f]=[...map.values()].sort((a,b)=>canonicalProfile(a).localeCompare(canonicalProfile(b)));}
 for(const [field,kind,idKey] of [['batches','batch','id'],['requestLog','log','requestId']]){
  const a=new Map((local[field]||[]).map(v=>[v[idKey],v])),b=new Map((remote[field]||[]).map(v=>[v[idKey],v]));
  merged[field]=union([...a.keys()],[...b.keys()]).map(id=>pick(kind,id,a.get(id),b.get(id))).filter(Boolean).map(v=>structuredClone(v));
 }
 const removed=new Set(merged.nukedIds);
 for(const b of merged.batches){b.ids=b.ids.filter(id=>!removed.has(id));merged.recommendedIds=union(merged.recommendedIds,b.originalIds||b.ids);}
 merged.batches.sort((a,b)=>String(a.created).localeCompare(String(b.created))||a.id.localeCompare(b.id));
 merged.requestLog.sort((a,b)=>String(a.time).localeCompare(String(b.time))||a.requestId.localeCompare(b.requestId));
 return merged;
}
export class CloudProfileSync{
 constructor({getProfile,applyProfile,request,loadMeta,saveMeta,validate,canApply=()=>true,onStatus=()=>{}}){Object.assign(this,{getProfile,applyProfile,request,loadMeta,saveMeta,validate,canApply,onStatus});this.meta={};this.stopped=false;}
 schedule(){if(this.stopped)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync('changes'),1200);}
 stop(){this.stopped=true;clearTimeout(this.timer);}
 async sync(choice){if(this.stopped)return;if(this.running){this.again=true;return this.running;}this.running=this.cycle(choice).catch(error=>{this.onStatus({message:error.message||'Cloud sync unavailable. Changes are saved on this device.',error:true,conflict:this.meta.conflict,recovery:!!this.meta.recovery});}).finally(()=>{this.running=null;if(this.again){this.again=false;this.schedule();}});return this.running;}
 async cycle(choice){
  if(!this.canApply()){this.schedule();return;}
  this.meta=await this.loadMeta()||{};if(choice==='changes'&&this.meta.syncedKey===canonicalProfile(this.getProfile()))return;this.onStatus({message:'Syncing cloud profile…'});
  const remote=await this.request('GET');if(this.stopped)return;
  if(remote.profile&&!this.validate(remote.profile))throw Error('Cloud profile is invalid. Your local data has not been changed.');
  if(!this.canApply()){this.schedule();return;}
  const local=this.getProfile(),localKey=canonicalProfile(local),remoteKey=remote.profile?canonicalProfile(remote.profile):null;
  if(choice==='cloud'&&remote.profile){this.meta.recovery=local;await this.saveMeta(this.meta);await this.adopt(remote);return;}
  if(choice==='device'){
   this.meta.recovery=remote.profile;await this.saveMeta(this.meta);
  }
  const merged=!remote.profile||choice==='device'?local:mergeProfiles(local,remote.profile),mergedKey=canonicalProfile(merged);
  if(remote.profile&&mergedKey===remoteKey){await this.adopt(remote);return;}
  if(!this.validate(merged))throw Error('The combined profile exceeds supported limits. Both copies are retained; export a backup before continuing.');
  const result=await this.request('PUT',{revision:remote.revision,profile:merged});if(this.stopped)return;
  if(result.conflict){this.again=true;this.onStatus({message:'Another device saved changes; combining them on the next sync.'});return;}
  await this.ack(result.revision,mergedKey,result.updatedAt);
  if(canonicalProfile(this.getProfile())===localKey&&this.canApply())await this.applyProfile(merged);
  if(canonicalProfile(this.getProfile())!==mergedKey)this.schedule();
 }
 async adopt(remote){if(this.stopped)return;await this.applyProfile(remote.profile);await this.ack(remote.revision,canonicalProfile(remote.profile),remote.updatedAt);if(canonicalProfile(this.getProfile())!==canonicalProfile(remote.profile))this.schedule();}
 async ack(revision,syncedKey,updatedAt){this.meta={...this.meta,revision,syncedKey,updatedAt,conflict:null};await this.saveMeta(this.meta);this.onStatus({message:'Saved to cloud'+(updatedAt?' · '+new Date(updatedAt).toLocaleString():''),recovery:!!this.meta.recovery});}
}
