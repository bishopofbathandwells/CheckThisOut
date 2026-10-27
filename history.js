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
 const playlists=[],seen=new Set();let offset=0;
 while(true){const page=await api(`/me/playlists?limit=50&offset=${offset}`);if(!Array.isArray(page.items))throw Error('Spotify returned an invalid playlist list.');let added=0;for(const p of page.items){if(!p?.id||seen.has(p.id))continue;seen.add(p.id);added++;if(!/^CheckThisOut\b/i.test(p.name||'')&&!/\[cto-(?:batch|keep):/i.test(p.description||''))playlists.push(p)}if(!page.next)break;if(!added)throw Error('Spotify repeated a playlist page. Try again.');offset+=page.items.length;}
 const pools=[],tracks=[];let readable=0,unavailable=0;
 for(const playlist of playlists){const pool=[],seenTracks=new Set();let start=0;
  while(true){let page;try{page=await api(`/playlists/${encodeURIComponent(playlist.id)}/items?limit=50&offset=${start}`)}catch(error){if([403,404].includes(error.status)){unavailable++;break}throw error}
   if(!Array.isArray(page.items))throw Error('Spotify returned an invalid playlist page.');let added=0;
   for(const item of page.items){const t=item?.item||item?.track;if(!t?.name||t.type==='episode'||t.is_local||!t.artists?.[0]?.name)continue;const key=t.uri||`${t.artists[0].name}|${t.name}`;if(seenTracks.has(key))continue;seenTracks.add(key);added++;const track={uri:t.uri||null,title:t.name,artist:t.artists[0].name,artists:t.artists.map(a=>a.name),isrc:t.external_ids?.isrc||null};pool.push(track);tracks.push(track)}
   if(!page.next){readable++;break}if(!page.items.length)throw Error('Spotify returned an incomplete playlist. Try again.');start+=page.items.length;if(start>100000)throw Error('Playlist is too large to finish reading.');
  }
  if(pool.length)pools.push(pool);
 }
 // Each playlist contributes across its length; a large first playlist cannot dominate.
 const samples=pools.map(pool=>Array.from({length:Math.min(200,pool.length)},(_,i)=>pool[Math.floor(i*pool.length/Math.min(200,pool.length))]));
 const playlistTracks=[],names=new Set();for(let row=0;row<200&&playlistTracks.length<200;row++)for(const pool of samples){const t=pool[row];if(!t)continue;const title=t.title.slice(0,120).trim(),artist=t.artist.slice(0,120).trim(),key=`${artist.toLowerCase()}|${title.toLowerCase()}`;if(!names.has(key)){names.add(key);playlistTracks.push({title,artist});if(playlistTracks.length===200)break}}
 return {playlistTracks,tracks:mergeKnown([],tracks),readable,unavailable};
}
