import test from 'node:test';
import assert from 'node:assert/strict';
import {loadKnownTracks,mergeKnown,probeHistory,loadPlaylistContext} from './history.js';
import {isKnown,selectDiscoveries} from './discovery.js';
test('history reads past the first 50 plays, even without a next URL',async()=>{
 const now=Date.now(),paths=[];
 const result=await loadKnownTracks(async path=>{paths.push(path);if(path.startsWith('/me/tracks'))return {items:[],next:null};const older=new URL('https://test'+path).searchParams.has('before');return {items:older?[{item:{uri:'heard-today',name:'Anti-Hero',artists:[{name:'Taylor Swift'}]},played_at:new Date(now-100000).toISOString()}]:Array.from({length:50},(_,i)=>({track:{uri:'recent'+i,name:'Recent '+i,artists:[{name:'Other'}]},played_at:new Date(now-i*1000).toISOString()})),next:null}});
 assert.equal(result.coverage.recentCount,51);assert(paths.some(p=>p.includes('before=')));assert(isKnown({uri:'other-release',title:'Anti-Hero',artist:'Taylor Swift'},result.tracks));
});
test('history archives persist tracks that fall out of the feed',()=>{
 const old=[{uri:'old',title:'Easy On Me',artist:'Adele'}],merged=mergeKnown(old,[{uri:'new',title:'New song',artist:'Other'}]);assert.equal(merged.length,2);assert(isKnown({uri:'different',title:'Easy On Me',artist:'Adele'},merged));
});
test('short history pages with a continuation are not treated as complete',async()=>{
 let calls=0;const result=await loadKnownTracks(async path=>{if(path.startsWith('/me/tracks'))return {items:[]};calls++;if(calls===3)return {items:[]};return {items:[{track:{uri:'u'+calls,name:'Song '+calls,artists:[{name:'Artist'}]},played_at:new Date(Date.now()-calls*10000).toISOString()}],next:'continuation'};});assert.equal(result.coverage.recentCount,2);assert.equal(calls,3);
});
test('feed diagnostics count raw rows before ignoring unavailable tracks',async()=>{
 const results=await probeHistory(async()=>({items:[{track:null,played_at:new Date().toISOString()},{track:{name:'Song'},played_at:new Date().toISOString()}],next:null}));assert.equal(results[0].rawRows,2);assert.equal(results[0].usableTracks,1);assert.equal(results.length,3);
});
test('familiar songs are excluded across release IDs, remasters, featured credits and artist order',()=>{
 assert(isKnown({title:'Pink Moon',artist:'Nick Drake'},[{title:'Pink Moon - 2012 Remaster',artist:'Nick Drake',uri:'old'}]));
 assert(isKnown({title:'Anti-Hero',artist:'Taylor Swift'},[{title:'Anti-Hero (feat. Guest)',artist:'Guest',artists:['Guest','Taylor Swift']}]))
 assert(!isKnown({title:'Pink Moon',artist:'Different cover artist'},[{title:'Pink Moon',artist:'Nick Drake'}]));
});
test('reported five familiar tracks cannot survive discovery selection',async()=>{
 const heard=[['Taylor Swift','Anti-Hero'],['Adele','Easy On Me'],['Gracie Abrams','That’s So True'],['Maisie Peters','There It Goes'],['Holly Humberstone','Paint My Bedroom Black']].map(([artist,title],i)=>({artist,title,uri:'old'+i}));
 const fresh=Array.from({length:7},(_,i)=>({artist:'New artist '+i,title:'New song '+i}));
 const selected=await selectDiscoveries([...heard,...fresh],heard,async t=>({...t,uri:'new-release:'+t.title}));assert.equal(selected.length,5);assert(selected.every(t=>!heard.some(h=>h.title===t.title)));
});
test('repeat pages stop safely and malformed history fails before generation',async()=>{
 const entry={track:{uri:'one',name:'One',artists:[{name:'Artist'}]},played_at:new Date().toISOString()};let reads=0;
 const result=await loadKnownTracks(async p=>p.startsWith('/me/tracks')?{items:[]}:(reads++,{items:Array(50).fill(entry)}));assert.equal(reads,2);assert(result.coverage.limited);
 await assert.rejects(()=>loadKnownTracks(async()=>({})),/invalid saved-song/);
});

test('playlist context paginates lists and tracks, excludes generated playlists and skips inaccessible content',async()=>{
 const paths=[];const result=await loadPlaylistContext(async path=>{paths.push(path);const u=new URL('https://test'+path),offset=Number(u.searchParams.get('offset'));
  if(u.pathname==='/me/playlists')return {items:offset?[{id:'other',name:'Other'},{id:'followed',name:'Followed'}]:[{id:'own',name:'My favourites'},{id:'cto',name:'CheckThisOut · Yesterday'}],next:offset?null:'more'};
  if(u.pathname==='/playlists/followed/items')throw Object.assign(Error('Forbidden'),{status:403});
  if(u.pathname==='/playlists/other/items')return {items:[{track:{name:'Other Song',artists:[{name:'Other Artist'}],uri:'other'}}],next:null};
  assert.equal(u.pathname,'/playlists/own/items');return {items:offset?[{item:{name:'Later Song',artists:[{name:'Main Artist'}],uri:'later'}}]:[{item:{name:'First Song',artists:[{name:'Main Artist'}],uri:'first'}},{item:null},{item:{name:'Podcast',type:'episode',artists:[{name:'Host'}]}}],next:offset?null:'more'};
 });
 assert.equal(result.readable,2);assert.equal(result.unavailable,1);assert.equal(result.tracks.length,3);assert.deepEqual(result.playlistTracks.map(t=>t.title),['First Song','Other Song','Later Song']);assert(paths.some(p=>p.includes('offset=3')));assert(!paths.some(p=>p.includes('/cto/')));
});
test('context sampling balances playlists, bounds metadata and does not swallow rate limits',async()=>{
 const result=await loadPlaylistContext(async path=>{if(path.startsWith('/me/playlists'))return {items:[{id:'huge'},{id:'small'}],next:null};const large=path.includes('/huge/'),offset=Number(new URL(path,'https://test').searchParams.get('offset'));return {items:Array.from({length:large?50:2},(_,i)=>({item:{uri:path+i,name:(large?'Large':'Small')+(offset+i)+'x'.repeat(200),artists:[{name:'Artist'}]}})),next:large&&offset+50<500?'more':null};});
 assert.equal(result.playlistTracks.length,200);assert(result.playlistTracks.some(t=>t.title.startsWith('Small')));assert(result.playlistTracks.every(t=>t.title.length<=120));assert.equal(result.tracks.length,202);assert(result.limited);
 await assert.rejects(()=>loadPlaylistContext(async path=>{if(path.startsWith('/me/playlists'))return {items:[{id:'one'}],next:null};throw Object.assign(Error('Rate limited'),{status:429})}),/Rate limited/);
});

test('playlist cache expires after 7 days, rejects other accounts and malformed data',async()=>{const {cachedPlaylistContext,PLAYLIST_CACHE_TTL_MS}=await import('./history.js');const now=100000000, data={tracks:[{title:'One',artist:'Artist'}],playlistTracks:[{title:'One',artist:'Artist'}]},cache={version:1,accountId:'alice',fetchedAt:now,data};assert.equal(cachedPlaylistContext(cache,'alice',now+PLAYLIST_CACHE_TTL_MS-1),data);assert.equal(cachedPlaylistContext(cache,'alice',now+PLAYLIST_CACHE_TTL_MS),null);assert.equal(cachedPlaylistContext(cache,'bob',now),null);assert.equal(cachedPlaylistContext(cache,'alice',now-1),null);assert.equal(cachedPlaylistContext({...cache,data:{}},'alice',now),null);assert.equal(cachedPlaylistContext(undefined,'alice',now),null);});

test('playlist loading caps unique tracks and balances reads across large playlists',async()=>{
 const {MAX_PLAYLIST_TRACKS,MAX_PLAYLIST_TRACK_PAGES}=await import('./history.js');let pages=0;
 const result=await loadPlaylistContext(async path=>{if(path.startsWith('/me/playlists'))return {items:Array.from({length:30},(_,i)=>({id:'p'+i})),next:null};pages++;const url=new URL(path,'https://test'),id=url.pathname.split('/')[2],offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));return {items:Array.from({length:limit},(_,i)=>({item:{uri:id+':'+(offset+i),name:id+' song '+(offset+i),artists:[{name:id}]}})),next:'more'};});
 assert.equal(result.tracks.length,MAX_PLAYLIST_TRACKS);assert(pages<=MAX_PLAYLIST_TRACK_PAGES);assert(new Set(result.tracks.map(t=>t.artist)).size>=10,'The capped context should represent multiple playlists.');assert(result.limited);
});
test('duplicate-heavy and empty playlist libraries have bounded page requests',async()=>{
 const {MAX_PLAYLIST_TRACK_PAGES}=await import('./history.js');let pages=0;const result=await loadPlaylistContext(async path=>{if(path.startsWith('/me/playlists'))return {items:Array.from({length:300},(_,i)=>({id:'p'+i})),next:null};pages++;return {items:Array.from({length:50},()=>({item:{uri:'same',name:'Same',artists:[{name:'Same'}]}})),next:'more'};});assert(pages<=MAX_PLAYLIST_TRACK_PAGES);assert.equal(result.tracks.length,1);assert(result.limited);
});
test('24h device read cache survives reopening, isolates accounts, coalesces loads and never caches failures',async()=>{
 const {SpotifyReadCache,READ_CACHE_TTL_MS}=await import('./history.js');let now=100000000,saved,calls=0;const options={accountId:'a',now:()=>now,load:async()=>saved,save:async value=>{saved=structuredClone(value)}};const valid=v=>v===null||typeof v==='object';const load=async()=>{calls++;return {song:'A'}};
 const cache=new SpotifyReadCache(options);await Promise.all([cache.get('history',load,valid),cache.get('history',load,valid)]);assert.equal(calls,1);
 await new SpotifyReadCache(options).get('history',load,valid);assert.equal(calls,1);now+=READ_CACHE_TTL_MS;await new SpotifyReadCache(options).get('history',load,valid);assert.equal(calls,2);
 await new SpotifyReadCache({...options,accountId:'b'}).get('history',load,valid);assert.equal(calls,3);
 const failed=new SpotifyReadCache({...options,load:async()=>null});for(let i=0;i<2;i++)await assert.rejects(()=>failed.get('search:bad',async()=>{calls++;throw Error('network')},valid));assert.equal(calls,5);
 await failed.get('search:missing',async()=>{calls++;return null},valid);await failed.get('search:missing',async()=>{throw Error('cached miss was lost')},valid);assert.equal(calls,6);
});
test('search cache is bounded, preserves history and tolerates unavailable storage',async()=>{
 const {SpotifyReadCache}=await import('./history.js');let tick=0,saved;const c=new SpotifyReadCache({accountId:'a',now:()=>100000000+tick++,load:async()=>null,save:async data=>{saved=data}});await c.get('history',async()=>({tracks:[]}),()=>true);for(let i=0;i<505;i++)await c.get('search:'+i,async()=>null,()=>true);assert.equal(Object.keys(saved.entries).length,501);assert(saved.entries.history);
 const broken=new SpotifyReadCache({accountId:'a',load:async()=>{throw Error('blocked')},save:async()=>{throw Error('full')}});assert.deepEqual(await broken.get('history',async()=>({ok:true}),()=>true),{ok:true});
});
