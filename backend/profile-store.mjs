const MAX_BYTES=8*1024*1024;
const allowed=new Set(['version','preferences','batchSize','alsoLike','appName','theme','batches','tracks','ratings','keeps','recommendedIds','nukedIds','known','userKnown','requestLog','keepPlaylistId','keepNeedsSync','syncEdits']);
export function validateCloudProfile(profile){
 if(!profile||typeof profile!=='object'||Array.isArray(profile)||Object.keys(profile).some(k=>!allowed.has(k))||profile.version!==1||!Array.isArray(profile.batches)||!Array.isArray(profile.keeps)||!profile.ratings||typeof profile.ratings!=='object'||Array.isArray(profile.ratings)||typeof profile.preferences!=='string')throw Object.assign(Error('Invalid cloud profile.'),{status:400});
 if(profile.syncEdits!==undefined&&(!profile.syncEdits||typeof profile.syncEdits!=='object'||Array.isArray(profile.syncEdits)||Object.entries(profile.syncEdits).some(([k,v])=>k.length>500||typeof v!=='string'||!/^\d{16}:[0-9a-f-]{36}$/.test(v))))throw Object.assign(Error('Invalid sync metadata.'),{status:400});
 if(profile.batches.some(b=>!b||typeof b.id!=='string'||!Array.isArray(b.ids)||Object.keys(b).some(k=>!['id','created','ids','source','requestId','originalIds','spotifyId','spotifySaved','spotifyName','preferences'].includes(k))))throw Object.assign(Error('Invalid batch data.'),{status:400});
 if(new TextEncoder().encode(JSON.stringify(profile)).length>MAX_BYTES)throw Object.assign(Error('Profile exceeds the 8 MB cloud limit. Export a backup; the local copy is unchanged.'),{status:413});
 return profile;
}
export async function readCloudProfile(db,userId){
 const meta=await db.prepare('SELECT revision, updated_at FROM profiles WHERE user_id = ?').bind(userId).first();if(!meta)return {revision:0,profile:null,updatedAt:null};
 const rows=await db.prepare('SELECT data FROM profile_chunks WHERE user_id = ? AND revision = ? ORDER BY part').bind(userId,meta.revision).all();
 if(!rows.results.length)throw Error('Profile data is incomplete.');return {revision:meta.revision,updatedAt:meta.updated_at,profile:JSON.parse(rows.results.map(r=>r.data).join(''))};
}
export async function writeCloudProfile(db,userId,revision,profile){
 if(!Number.isSafeInteger(revision)||revision<0)throw Object.assign(Error('Invalid profile revision.'),{status:400});validateCloudProfile(profile);
 const data=JSON.stringify(profile),next=revision+1,commit=crypto.randomUUID(),updatedAt=new Date().toISOString();
 const statements=[revision===0?db.prepare('INSERT OR IGNORE INTO profiles(user_id, revision, updated_at, commit_id) VALUES (?, ?, ?, ?)').bind(userId,next,updatedAt,commit):db.prepare('UPDATE profiles SET revision = ?, updated_at = ?, commit_id = ? WHERE user_id = ? AND revision = ?').bind(next,updatedAt,commit,userId,revision)];
 // Each chunk stays below D1's row-size limit, including non-ASCII metadata.
 for(let part=0,start=0;start<data.length;part++){let end=Math.min(start+200000,data.length);if(end<data.length&&/[\uD800-\uDBFF]/.test(data[end-1]))end--;statements.push(db.prepare('INSERT INTO profile_chunks(user_id, revision, part, data) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM profiles WHERE user_id = ? AND commit_id = ?)').bind(userId,next,part,data.slice(start,end),userId,commit));start=end;}
 statements.push(db.prepare('DELETE FROM profile_chunks WHERE user_id = ? AND revision < ? AND EXISTS (SELECT 1 FROM profiles WHERE user_id = ? AND commit_id = ?)').bind(userId,Math.max(1,next-4),userId,commit));
 const results=await db.batch(statements);if(!results[0].meta.changes)return {conflict:true,...await readCloudProfile(db,userId)};
 return {revision:next,updatedAt};
}

// Owner-only aggregate view; callers must authorize before invoking this function.
export async function profileUsage(db,userIds){
 return Promise.all([...new Set(userIds)].map(async userId=>{
  const saved=await readCloudProfile(db,userId),batches=saved.profile?.batches||[];
  const dates=batches.map(b=>b.created).filter(d=>Number.isFinite(Date.parse(d))).sort((a,b)=>Date.parse(b)-Date.parse(a));
  return {userId,batchCount:saved.profile?batches.length:null,latestBatch:dates[0]||null,lastSyncedAt:saved.updatedAt};
 }));
}
