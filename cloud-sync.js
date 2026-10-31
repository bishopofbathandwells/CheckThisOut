export function canonicalProfile(value){if(Array.isArray(value))return '['+value.map(canonicalProfile).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalProfile(value[k])).join(',')+'}';return JSON.stringify(value);}
export function hasProfileData(p){return !!(p.batches?.length||p.keeps?.length||Object.keys(p.ratings||{}).length||p.requestLog?.length||p.preferences||p.appName&&p.appName!=='Hidden Gems'||p.theme&&p.theme!=='precision'||p.alsoLike===false);}
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
  if(remote.profile&&localKey===remoteKey){await this.ack(remote.revision,localKey,remote.updatedAt);return;}
  if(remote.profile&&choice!=='device'&&(!hasProfileData(local)||this.meta.syncedKey===localKey)){await this.adopt(remote);return;}
  if(!remote.profile||choice==='device'||this.meta.revision===remote.revision&&this.meta.syncedKey!==undefined){
   const result=await this.request('PUT',{revision:remote.revision,profile:local});if(this.stopped)return;
   if(result.conflict){this.meta.conflict=result;await this.saveMeta(this.meta);this.onStatus({message:'Another device changed this profile. Both copies are retained; choose which version to use.',conflict:result,recovery:!!this.meta.recovery});return;}
   await this.ack(result.revision,localKey,result.updatedAt);if(canonicalProfile(this.getProfile())!==localKey)this.schedule();return;
  }
  this.meta.conflict=remote;await this.saveMeta(this.meta);this.onStatus({message:'This device and the cloud have different unsynced changes. Choose a version below; neither is overwritten automatically.',conflict:remote,recovery:!!this.meta.recovery});
 }
 async adopt(remote){if(this.stopped)return;await this.applyProfile(remote.profile);await this.ack(remote.revision,canonicalProfile(remote.profile),remote.updatedAt);if(canonicalProfile(this.getProfile())!==canonicalProfile(remote.profile))this.schedule();}
 async ack(revision,syncedKey,updatedAt){this.meta={...this.meta,revision,syncedKey,updatedAt,conflict:null};await this.saveMeta(this.meta);this.onStatus({message:'Saved to cloud'+(updatedAt?' · '+new Date(updatedAt).toLocaleString():''),recovery:!!this.meta.recovery});}
}
