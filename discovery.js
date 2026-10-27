const normal=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]/gu,'');
// Discovery excludes familiar compositions across remasters, deluxe releases,
// featured credits and live versions, not merely identical Spotify IDs.
const baseTitle=s=>s.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with|live\b|remaster\w*\b|\d{4}\s+remaster\w*\b|taylor[’']s version\b)[^)\]]*[)\]]\s*$/i,'').replace(/\s*[-–—]\s*(?:live\b|remaster\w*\b|\d{4}\s+remaster\w*\b|feat\.?\s|ft\.?\s|single version\b|radio edit\b).*$/i,'').trim();
const keys=t=>(t.artists?.length?t.artists:[t.artist]).map(a=>normal(a)+'|'+normal(baseTitle(t.title)));
export function isKnown(track,known){const names=new Set(known.flatMap(keys));return known.some(t=>t.uri&&t.uri===track.uri||t.isrc&&track.isrc&&t.isrc===track.isrc)||keys(track).some(k=>names.has(k));}
const brief=t=>({title:t.title,artist:t.artist,uri:t.uri||null,isrc:t.isrc||null,source:t.source||'library_or_history'});
function indexTracks(tracks){const index={uri:new Map(),isrc:new Map(),name:new Map()};for(const t of tracks)addTrack(index,t);return index}
function addTrack(index,t){if(t.uri&&!index.uri.has(t.uri))index.uri.set(t.uri,t);if(t.isrc&&!index.isrc.has(t.isrc))index.isrc.set(t.isrc,t);for(const key of keys(t))if(!index.name.has(key))index.name.set(key,t)}
function findMatch(t,index){if(t.uri&&index.uri.has(t.uri))return {track:index.uri.get(t.uri),by:'spotify_uri'};if(t.isrc&&index.isrc.has(t.isrc))return {track:index.isrc.get(t.isrc),by:'isrc'};for(const key of keys(t))if(index.name.has(key))return {track:index.name.get(key),by:'artist_title'};return null}
export async function selectDiscoveries(candidates,known,resolve,count=5,audit=[]){
 if(!Number.isInteger(count)||count<1||count>10)throw Error('Choose 1 to 10 songs per batch.');
 const index=indexTracks(known),tracks=[];let unmatched=0;
 const reject=(candidate,match,stage,resolved)=>audit.push({candidate:brief(candidate),outcome:'rejected',reason:match.track.source==='current_batch'?'duplicate_in_batch':match.track.source==='previous_recommendation'?'previously_recommended':'already_known',matchedBy:match.by,matchedTo:brief(match.track),stage,...(resolved?{resolved:brief(resolved)}:{})});
 for(let i=0;i<candidates.length;i++){
  const candidate=candidates[i];
  if(tracks.length===count){audit.push({candidate:brief(candidate),outcome:'unused',reason:'batch_full'});continue}
  const before=findMatch(candidate,index);if(before){reject(candidate,before,'before_lookup');continue}
  let track;try{track=await resolve(candidate)}catch(error){if(error.message.startsWith('No exact Spotify match')){unmatched++;audit.push({candidate:brief(candidate),outcome:'rejected',reason:'no_exact_spotify_match',detail:error.message});continue}audit.push({candidate:brief(candidate),outcome:'error',reason:'spotify_lookup_failed',detail:error.message});for(const rest of candidates.slice(i+1))audit.push({candidate:brief(rest),outcome:'unused',reason:'lookup_interrupted'});throw error}
  const after=findMatch(track,index);if(after){reject(candidate,after,'after_lookup',track);continue}
  const selected={...track,id:track.uri,color:['#538a91','#ac694e','#8d6c9d','#4b897c','#a57653'][tracks.length%5]};tracks.push(selected);addTrack(index,{...track,source:'current_batch'});audit.push({candidate:brief(candidate),resolved:brief(track),outcome:'accepted',reason:'new_matched_song'});
 }
 if(tracks.length)return tracks;
 throw Error(`Only 0 new, matched songs were found${unmatched?` (${unmatched} candidate${unmatched===1?'':'s'} could not be matched)`:''}. No batch playlist was created. Try adjusting your discovery preferences.`);
}
