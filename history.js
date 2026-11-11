// Spotify data stays on-device; this module never sends history to the model.
export async function loadKnownTracks(api){
 const tracks=[],savedSongs=[],recentPlays=[];let savedCount=0,offset=0;
 const convert=t=>({uri:t.uri,title:t.name,artist:t.artists?.[0]?.name||'',artists:t.artists?.map(a=>a.name)||[],isrc:t.external_ids?.isrc||null});
 while(true){const data=await api(`/me/tracks?limit=50&offset=${offset}`);if(!Array.isArray(data.items))throw Error('Spotify returned an invalid saved-song response.');const saved=data.items.map(i=>i.track||i.item).filter(t=>t?.name).map(convert);tracks.push(...saved);savedSongs.push(...saved);savedCount+=saved.length;if(!data.next)break;if(!data.items.length||offset>=9950)throw Error('Could not finish checking your saved songs. No recommendation request was made.');offset+=data.items.length;}
 let before,oldest=null,newest=null,recentCount=0,pages=0,limited=false;const events=new Set();
 for(;pages<20;pages++){
  const page=await api('/me/player/recently-played?'+new URLSearchParams({limit:'50',...(before?{before:String(before)}:{})}));
  if(!Array.isArray(page.items))throw Error('Spotify returned an invalid listening-history response.');
  if(!page.items.length)break;
  let earliest=Infinity,added=0;
  for(const entry of page.items){const t=entry.track||entry.item;if(!t?.name)continue;const stamp=Date.parse(entry.played_at),key=`${t.uri}:${entry.played_at}`;if(events.has(key))continue;events.add(key);added++;recentCount++;tracks.push(convert(t));recentPlays.push({...convert(t),playedAt:Number.isFinite(stamp)?new Date(stamp).toISOString():null});if(Number.isFinite(stamp)){earliest=Math.min(earliest,stamp);oldest=oldest===null?stamp:Math.min(oldest,stamp);newest=newest===null?stamp:Math.max(newest,stamp);}}
  if(!added){limited=true;break}
  if(page.items.length<50&&!page.next)break;
  if(!Number.isFinite(earliest)||before&&earliest>=before){limited=true;break}
  before=earliest;
 }
 if(pages===20)limited=true;
 return {tracks,savedSongs,recentPlays,coverage:{savedCount,recentCount,oldest,newest,limited,checked:new Date().toISOString()}};
}
export function mergeKnown(archive=[],tracks=[]){
 const map=new Map(archive.map(t=>[t.uri||`${t.artist}|${t.title}`,t]));for(const t of tracks)map.set(t.uri||`${t.artist}|${t.title}`,t);return [...map.values()];
}
export async function probeHistory(api){
 const results=[];let oldest;
 for(const kind of ['latest','last-six-days','before-oldest']){
  const params=new URLSearchParams({limit:'50'});if(kind==='last-six-days')params.set('after',String(Date.now()-6*86400000));if(kind==='before-oldest'){if(!oldest)continue;params.set('before',String(oldest));}
  try{const data=await api('/me/player/recently-played?'+params),items=Array.isArray(data.items)?data.items:[],stamps=items.map(i=>Date.parse(i.played_at)).filter(Number.isFinite);if(kind==='latest'&&stamps.length)oldest=Math.min(...stamps);
   results.push({query:kind,requested:50,rawRows:items.length,usableTracks:items.filter(i=>(i.track||i.item)?.name).length,oldest:stamps.length?new Date(Math.min(...stamps)).toISOString():null,newest:stamps.length?new Date(Math.max(...stamps)).toISOString():null,hasNext:!!data.next});
  }catch(error){results.push({query:kind,error:error.message});break}
 }
 return results;
}

// Read accessible saved playlists; send only a balanced, bounded metadata sample.
export async function loadPlaylistContext(api){
 const playlists=[],seen=new Set();let offset=0,listPages=0,playlistListLimited=false;
 while(true){listPages++;const page=await api(`/me/playlists?limit=50&offset=${offset}`);if(!Array.isArray(page.items))throw Error('Spotify returned an invalid playlist list.');let added=0;for(const p of page.items){if(!p?.id||seen.has(p.id))continue;seen.add(p.id);added++;if(!/^CheckThisOut\b/i.test(p.name||'')&&!/\[cto-(?:batch|keep):/i.test(p.description||''))playlists.push(p)}if(!page.next)break;if(!added)throw Error('Spotify repeated a playlist page. Try again.');if(listPages>=20){playlistListLimited=true;break}offset+=page.items.length;}
 const chosen=playlists.length<=MAX_CONTEXT_PLAYLISTS?playlists:Array.from({length:MAX_CONTEXT_PLAYLISTS},(_,i)=>playlists[Math.floor(i*playlists.length/MAX_CONTEXT_PLAYLISTS)]);
 const queue=chosen.map(playlist=>({playlist,pool:[],seen:new Set(),offset:0,rows:0})),pools=queue.map(x=>x.pool),unique=new Map();let readable=0,unavailable=0,trackPages=0,rowsLoaded=0,limited=playlists.length>chosen.length||playlistListLimited;
 // One page per playlist per pass keeps the capped sample balanced.
 while(queue.length&&unique.size<MAX_PLAYLIST_TRACKS&&trackPages<MAX_PLAYLIST_TRACK_PAGES){
  const task=queue.shift(),limit=Math.min(50,MAX_TRACKS_PER_PLAYLIST-task.rows,MAX_PLAYLIST_TRACKS-unique.size);let page;trackPages++;
  try{page=await api(`/playlists/${encodeURIComponent(task.playlist.id)}/items?limit=${limit}&offset=${task.offset}`)}catch(error){if([403,404].includes(error.status)){unavailable++;continue}throw error}
  if(!Array.isArray(page.items))throw Error('Spotify returned an invalid playlist page.');
  const items=page.items.slice(0,limit);task.rows+=items.length;rowsLoaded+=items.length;
  for(const item of items){const t=item?.item||item?.track;if(!t?.name||t.type==='episode'||t.is_local||!t.artists?.[0]?.name)continue;const key=t.uri||`${t.artists[0].name}|${t.name}`;if(task.seen.has(key))continue;task.seen.add(key);const track={uri:t.uri||null,title:t.name,artist:t.artists[0].name,artists:t.artists.map(a=>a.name),isrc:t.external_ids?.isrc||null};task.pool.push(track);if(!unique.has(key))unique.set(key,track);}
  if(!page.next){readable++;continue}
  if(!items.length)throw Error('Spotify returned an incomplete playlist. Try again.');task.offset+=items.length;
  if(task.rows>=MAX_TRACKS_PER_PLAYLIST)limited=true;else queue.push(task);
 }
 if(queue.length)limited=true;
 const tracks=[...unique.values()];
 // Each playlist contributes across its length; a large first playlist cannot dominate.
 const samples=pools.map(pool=>Array.from({length:Math.min(200,pool.length)},(_,i)=>pool[Math.floor(i*pool.length/Math.min(200,pool.length))]));
 const playlistTracks=[],names=new Set();for(let row=0;row<200&&playlistTracks.length<200;row++)for(const pool of samples){const t=pool[row];if(!t)continue;const title=t.title.slice(0,120).trim(),artist=t.artist.slice(0,120).trim(),key=`${artist.toLowerCase()}|${title.toLowerCase()}`;if(!names.has(key)){names.add(key);playlistTracks.push({title,artist});if(playlistTracks.length===200)break}}
 return {playlistTracks,tracks,readable,unavailable,limited,trackPages,rowsLoaded,playlistsSeen:playlists.length};
}

export const PLAYLIST_CACHE_TTL_MS=7*24*60*60*1000;
export const MAX_PLAYLIST_TRACKS=1000,MAX_TRACKS_PER_PLAYLIST=200,MAX_CONTEXT_PLAYLISTS=100,MAX_PLAYLIST_TRACK_PAGES=100;
export const READ_CACHE_TTL_MS=24*60*60*1000;
export function cachedPlaylistContext(cache,accountId,now=Date.now()){
 const song=t=>t&&typeof t.title==='string'&&typeof t.artist==='string';
 if(!cache||cache.version!==1||cache.accountId!==accountId||!Number.isFinite(cache.fetchedAt)||now<cache.fetchedAt||now-cache.fetchedAt>=PLAYLIST_CACHE_TTL_MS)return null;
 const data=cache.data;if(!data||!Array.isArray(data.tracks)||!data.tracks.every(song)||!Array.isArray(data.playlistTracks)||data.playlistTracks.length>200||!data.playlistTracks.every(song))return null;
 return data.tracks.length>MAX_PLAYLIST_TRACKS?{...data,tracks:data.tracks.slice(0,MAX_PLAYLIST_TRACKS),limited:true}:data;
}

// Device-only, per-account cache. Failures are never cached; writes are serialized.
export class SpotifyReadCache{
 constructor({accountId,load,save,now=Date.now}){Object.assign(this,{accountId,load,save,now});this.entries={};this.pending=new Map();this.writes=Promise.resolve();}
 async ready(){if(!this.loading)this.loading=(async()=>{try{const saved=await this.load();if(saved?.version===1&&saved.accountId===this.accountId&&saved.entries&&typeof saved.entries==='object'&&!Array.isArray(saved.entries))this.entries=saved.entries;}catch{}this.prune();})();await this.loading;}
 fresh(entry){const age=this.now()-entry?.fetchedAt;return Number.isFinite(age)&&age>=0&&age<READ_CACHE_TTL_MS;}
 prune(){for(const [key,entry] of Object.entries(this.entries))if(!this.fresh(entry))delete this.entries[key];const searches=Object.keys(this.entries).filter(k=>k!=='history').sort((a,b)=>this.entries[a].fetchedAt-this.entries[b].fetchedAt);for(const key of searches.slice(0,Math.max(0,searches.length-500)))delete this.entries[key];}
 async get(key,loader,valid){
  await this.ready();const cached=this.entries[key];if(this.fresh(cached)&&valid(cached.value))return structuredClone(cached.value);
  if(!this.pending.has(key)){const task=(async()=>{const value=await loader();if(!valid(value))return value;this.entries[key]={fetchedAt:this.now(),value:structuredClone(value)};this.prune();this.writes=this.writes.then(()=>this.save({version:1,accountId:this.accountId,entries:structuredClone(this.entries)})).catch(()=>{});await this.writes;return value;})().finally(()=>this.pending.delete(key));this.pending.set(key,task);}
  return structuredClone(await this.pending.get(key));
 }
}
