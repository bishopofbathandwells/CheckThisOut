// Public application identifier. PKCE deliberately requires no client secret.
import {loadKnownTracks,probeHistory,loadPlaylistContext} from './history.js';
const CLIENT_ID='4f83f3ad82254f3e9e8ab374f04b146b';
const AUTH_KEY='cto-spotify-session',PENDING_KEY='cto-spotify-pkce';
const SCOPES='playlist-modify-private playlist-read-private playlist-read-collaborative user-library-modify user-library-read user-read-recently-played';
let refreshPromise,playlistContextPromise;
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key)||'null')}catch{return null}};
const base64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const random=()=>base64(crypto.getRandomValues(new Uint8Array(48)));
export function disconnect(){playlistContextPromise=undefined;sessionStorage.removeItem(AUTH_KEY);sessionStorage.removeItem(PENDING_KEY)}
export async function connect(){
 const verifier=random(),state=random(),redirect=new URL(location.hostname.endsWith('.github.io')?'callback.html':'callback',new URL('./',location.href)).href;
 const challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
 sessionStorage.setItem(PENDING_KEY,JSON.stringify({verifier,state,redirect,created:Date.now()}));
 const params=new URLSearchParams({client_id:CLIENT_ID,response_type:'code',redirect_uri:redirect,scope:SCOPES,state,code_challenge_method:'S256',code_challenge:challenge,show_dialog:'true'});
 location.assign('https://accounts.spotify.com/authorize?'+params);
}
async function tokenRequest(params,previous){
 const response=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID,...params})});
 if(!response.ok){if(response.status===400||response.status===401)disconnect();throw Error('Spotify authorisation failed. Please connect again.');}
 const data=await response.json();if(!data.access_token)throw Error('Spotify did not return an access token.');
 const session={access_token:data.access_token,refresh_token:data.refresh_token||previous?.refresh_token,expires:Date.now()+data.expires_in*1000};
 sessionStorage.setItem(AUTH_KEY,JSON.stringify(session));return session;
}
export async function finishAuth(){
 const params=new URLSearchParams(location.search);if(!params.has('code')&&!params.has('error'))return false;
 const pending=read(PENDING_KEY);history.replaceState({},'',new URL('./',location.href).pathname);
 sessionStorage.removeItem(PENDING_KEY);
 if(!pending||params.get('state')!==pending.state||Date.now()-pending.created>600000)throw Error('Spotify sign-in expired or could not be verified. Please connect again.');
 if(params.has('error'))throw Error('Spotify access was not granted. You can try Connect Spotify again.');
 await tokenRequest({grant_type:'authorization_code',code:params.get('code'),redirect_uri:pending.redirect,code_verifier:pending.verifier});return true;
}
export function hasSession(){return !!read(AUTH_KEY)?.access_token}
async function accessToken(force=false){let session=read(AUTH_KEY);if(!session)throw Error('Connect Spotify first.');
 if(force||session.expires<Date.now()+60000){if(!session.refresh_token){disconnect();throw Error('Spotify session expired. Please connect again.');}
 refreshPromise ||= tokenRequest({grant_type:'refresh_token',refresh_token:session.refresh_token},session).finally(()=>{refreshPromise=undefined});session=await refreshPromise;}return session.access_token;
}
export async function api(path,{method='GET',body}={},retried=false){
 const token=await accessToken();let response;
 try{response=await fetch('https://api.spotify.com/v1'+path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})}catch{throw Error('Spotify connection interrupted. Retry the action; an existing playlist will be checked first.');}
 if(response.status===401&&!retried){await accessToken(true);return api(path,{method,body},true)}
 if(!response.ok){if([403,404].includes(response.status))throw Object.assign(Error(response.status===403?'Spotify denied access to this playlist. Reconnect to grant playlist permissions.':'Spotify playlist is unavailable.'),{status:response.status});if(response.status===429)throw Error(`Spotify rate limit reached. Try again in ${response.headers.get('Retry-After')||'a few'} seconds.`);throw Error(`Spotify request failed (${response.status}). Retry the action after checking your connection.`)}
 const text=await response.text();return text?JSON.parse(text):null;
}
export async function currentUser(){const user=await api('/me');if(!user.id)throw Error('Spotify did not identify this account.');return user}
export async function findTrack(track){
 const q=`track:"${track.title}" artist:"${track.artist}"`;
 const result=await api('/search?'+new URLSearchParams({q,type:'track',limit:'5'}));
 const normal=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]/gu,'');
 // Featured performers are credits, not a different recording. Keep live/remix/
 // remaster suffixes significant so matching cannot silently change the version.
 const withoutCredits=s=>s.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[)\]]\s*$/i,'').replace(/\s*[-–]\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i,'').trim();
 const matches=result.tracks?.items?.filter(t=>normal(withoutCredits(t.name))===normal(withoutCredits(track.title))&&t.artists.some(a=>normal(a.name)===normal(track.artist))&&t.is_playable!==false)||[];
 const match=matches.find(t=>normal(t.name)===normal(track.title))||matches[0];
 if(!match)throw Error(`No exact Spotify match for “${track.title}” by ${track.artist}. Nothing was substituted.`);
 return {uri:match.uri,url:match.external_urls.spotify,title:match.name,artist:match.artists[0].name,isrc:match.external_ids?.isrc||null};
}
async function findPlaylist(userId,marker){let offset=0;while(true){const data=await api(`/me/playlists?limit=20&offset=${offset}`);const match=data.items.find(p=>p&&p.owner?.id===userId&&p.description?.includes(marker));if(match)return match;if(!data.next)return null;offset+=data.items.length;if(!data.items.length)throw Error('Spotify returned an incomplete playlist list.');}}
export async function ensurePlaylist(userId,marker,name,onCreated,savedId){
 if(savedId)return savedId;
 const existing=await findPlaylist(userId,marker);
 if(existing){await onCreated(existing.id);return existing.id;}
 const created=await api('/me/playlists',{method:'POST',body:{name,public:false,description:`Created by CheckThisOut. ${marker}`}});
 await onCreated(created.id);return created.id;
}
export async function playlistUris(id){const uris=[];let offset=0;while(true){const data=await api(`/playlists/${id}/items?limit=50&offset=${offset}`);for(const entry of data.items)uris.push((entry.item||entry.track)?.uri||null);if(!data.next)return uris;if(!data.items.length)throw Error('Spotify returned an incomplete playlist.');offset+=data.items.length;}}
export async function replaceBatch(id,uris){
 if(!uris.length||uris.length>10||new Set(uris).size!==uris.length)throw Error('A batch must contain one to ten distinct Spotify tracks.');
 await api(`/playlists/${id}/items`,{method:'PUT',body:{uris}});
 const saved=await playlistUris(id);
 if(saved.length!==uris.length||saved.some((uri,i)=>uri!==uris[i]))throw Error(`Spotify playlist verification failed: expected ${uris.length===5?'five':uris.length} matching songs, found ${saved.length}. Retry saving this playlist.`);
 return saved.length;
}
export async function removeBatchTrack(id,uri){
 const existing=await playlistUris(id);if(!existing.includes(uri))return;
 await api(`/playlists/${id}/items`,{method:'DELETE',body:{items:[{uri}]}});
 if((await playlistUris(id)).includes(uri))throw Error('Spotify still contains this song. It has not been removed from the app; press Remove to retry.');
}
export async function keepTrack(id,uri){
 let offset=0;while(true){const data=await api(`/playlists/${id}/items?limit=50&offset=${offset}`);if(data.items.some(i=>(i.item||i.track)?.uri===uri))return;if(!data.next)break;if(!data.items.length)throw Error('Spotify returned an incomplete Keep playlist.');offset+=data.items.length;}
 await api(`/playlists/${id}/items`,{method:'POST',body:{uris:[uri]}});
}
export async function likeTrack(uri){await api('/me/library?'+new URLSearchParams({uris:uri}),{method:'PUT'})}

export async function knownTracks(){
 return loadKnownTracks(api);
}
export async function playlistContext(){playlistContextPromise ||= loadPlaylistContext(api).catch(error=>{playlistContextPromise=undefined;throw error});return playlistContextPromise;}
export async function historyProbe(){return probeHistory(api)}
export async function requestCandidates(endpoint,preferences,requestId,batchSize=5,playlistTracks,exclusions){
 const url=new URL(endpoint);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Recommendation service must use HTTPS.');
 const send=async force=>fetch(url,{method:'POST',signal:AbortSignal.timeout(110000),headers:{Authorization:`Bearer ${await accessToken(force)}`,'Content-Type':'application/json'},body:JSON.stringify({requestId,preferences,batchSize,...(playlistTracks?{playlistTracks}:{}),...(exclusions?{exclusions}:{})})});
 let response=await send(false);if(response.status===401)response=await send(true);
 const data=await response.json();if(!response.ok){const error=Error(data.error||'Recommendation request failed.');error.usage=data.usage||null;error.errorCode=data.errorCode;error.elapsedMs=data.elapsedMs;error.cached=!!data.cached;error.terminal=response.status===502||response.status===504||response.status===400;throw error;}
 if(!Array.isArray(data.songs)||data.songs.length!==Math.max(12,batchSize*2)||data.songs.some(t=>!t||typeof t.title!=='string'||typeof t.artist!=='string'||t.title.length>180||t.artist.length>180))throw Error('Recommendation service returned an invalid song list.');
 return data;
}
export async function recommendationUsage(endpoint){const url=new URL(endpoint);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Invalid recommendation service.');url.pathname=url.pathname.replace(/\/recommend$/,'/usage');const send=async force=>fetch(url,{headers:{Authorization:`Bearer ${await accessToken(force)}`},signal:AbortSignal.timeout(10000)});let response=await send(false);if(response.status===401)response=await send(true);const data=await response.json();if(!response.ok)throw Error(data.error||'Could not check allowance.');return data;}

export async function cachedCandidates(endpoint,requestId){const url=new URL(endpoint);url.pathname=url.pathname.replace(/\/recommend$/,'/result');url.search=new URLSearchParams({requestId});const send=async force=>fetch(url,{headers:{Authorization:`Bearer ${await accessToken(force)}`},signal:AbortSignal.timeout(15000)});let response=await send(false);if(response.status===401)response=await send(true);const data=await response.json();if(!response.ok)throw Error(data.error||'Cached result unavailable.');return data;}

export async function playlistName(id){const p=await api(`/playlists/${encodeURIComponent(id)}?fields=name`);if(typeof p?.name!=='string'||!p.name.trim())throw Error('Spotify did not return the playlist name.');return p.name;}
