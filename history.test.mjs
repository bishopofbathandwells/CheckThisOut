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
 const result=await loadPlaylistContext(async path=>path.startsWith('/me/playlists')?{items:[{id:'huge'},{id:'small'}],next:null}:{items:Array.from({length:path.includes('/huge/')?500:2},(_,i)=>({item:{uri:path+i,name:(path.includes('/huge/')?'Large':'Small')+i+'x'.repeat(200),artists:[{name:'Artist'}]}})),next:null});
 assert.equal(result.playlistTracks.length,200);assert(result.playlistTracks.some(t=>t.title.startsWith('Small')));assert(result.playlistTracks.every(t=>t.title.length<=120));assert.equal(result.tracks.length,502);
 await assert.rejects(()=>loadPlaylistContext(async path=>{if(path.startsWith('/me/playlists'))return {items:[{id:'one'}],next:null};throw Object.assign(Error('Rate limited'),{status:429})}),/Rate limited/);
});
