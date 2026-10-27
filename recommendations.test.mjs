import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberRecommendations,recordBatch,removeFromBatch,modelExclusions} from './recommendations.js';
import {selectDiscoveries} from './discovery.js';
test('existing batches migrate into permanent recommendation history',()=>{const p={batches:[{ids:['a','b']},{ids:['c']}]};assert.deepEqual(rememberRecommendations(p),['a','b','c']);assert.deepEqual(p.batches[0].originalIds,['a','b']);});
test('removing every song retains original IDs and exclusion history after reload',()=>{let p={batches:[]};const b={ids:['a','b','c','d','e']};recordBatch(p,b);for(const id of [...b.ids])removeFromBatch(p,b,id);assert.equal(b.ids.length,0);p=JSON.parse(JSON.stringify(p));assert.deepEqual(rememberRecommendations(p),['a','b','c','d','e']);assert.equal(p.nukedIds.length,5);assert.equal(p.batches[0].originalIds.length,5);});
test('removal from one batch does not touch keeps, ratings or other batches',()=>{const p={batches:[{ids:['a','b']},{ids:['c','d']}],keeps:['a'],ratings:{a:4}};removeFromBatch(p,p.batches[0],'a');assert.deepEqual(p.batches[1].ids,['c','d']);assert.deepEqual(p.keeps,['a']);assert.equal(p.ratings.a,4);});
test('removed recommendations and alternate releases are excluded from future selection',async()=>{const known={id:'old',uri:'old',artist:'Artist',title:'Song'};const p={batches:[]};const b={ids:['old']};recordBatch(p,b);removeFromBatch(p,b,'old');const candidates=[{artist:'Artist',title:'Song'},...Array.from({length:5},(_,i)=>({artist:'New',title:'New '+i}))];const selected=await selectDiscoveries(candidates,p.recommendedIds.map(()=>known),async t=>({...t,uri:'new:'+t.title}));assert.equal(selected.length,5);assert(selected.every(t=>t.title!=='Song'));});

test('partial batches retain usable discoveries while filtering familiar, duplicate and unmatched candidates',async()=>{
 const candidates=Array.from({length:10},(_,i)=>({title:'Candidate '+i,artist:'Artist'}));
 const tracks=await selectDiscoveries(candidates,[candidates[0]],async t=>{const i=Number(t.title.split(' ').at(-1));if(i===1)throw Error('No exact Spotify match');return {...t,uri:'track'+(i===3?2:i)}},10);
 assert.equal(tracks.length,7);assert.equal(new Set(tracks.map(t=>t.uri)).size,7);assert(!tracks.some(t=>t.title==='Candidate 0'));
 await assert.rejects(()=>selectDiscoveries(candidates,candidates,async()=>{throw Error('Should not resolve')},10),/Only 0/);
});

test('Kano ampersand and word-and variants are excluded before and after Spotify matching',async()=>{
 const known=[{title:"P's and Q's",artist:'Kano',uri:'old-release'}];
 const direct=await selectDiscoveries([{title:"P’s & Q’s",artist:'Kano'},{title:'Fresh',artist:'Other'}],known,async t=>({...t,uri:'new-release'}),1);assert.equal(direct[0].title,'Fresh');
 const resolved=await selectDiscoveries([{title:'Other spelling',artist:'Kano'},{title:'Fresh',artist:'Other'}],known,async t=>t.artist==='Kano'?{title:"P's & Q's",artist:'Kano',uri:'new-release'}:{...t,uri:'fresh'},1);assert.equal(resolved[0].title,'Fresh');
});
test('model exclusions include complete history with duplicates collapsed and no Spotify identifiers',()=>{
 const exclusions=modelExclusions([{title:'Song',artist:'Artist',uri:'private'}, {title:'Song',artist:'Artist'},{title:'Old',artist:'Kano',artists:['Kano','Guest']}]);assert.equal(exclusions.length,3);assert(!JSON.stringify(exclusions).includes('private'));
});

test('decision audit identifies previous/known/duplicate/unmatched songs, exact match evidence and unused candidates',async()=>{
 const audit=[],known=[{title:'Old',artist:'Artist',uri:'old',source:'previous_recommendation'},{title:'Library',artist:'Artist',uri:'library',isrc:'library-isrc',source:'saved_playlist'}],candidates=['Old','Alias','Missing','New','Duplicate','Enough','Unused'].map(title=>({title,artist:'Artist'}));
 const tracks=await selectDiscoveries(candidates,known,async t=>{if(t.title==='Alias')return {...t,uri:'other',isrc:'library-isrc'};if(t.title==='Missing')throw Error('No exact Spotify match');return {...t,uri:t.title==='Duplicate'?'New':t.title}},2,audit);
 assert.equal(tracks.length,2);assert.deepEqual(audit.map(d=>d.reason),['previously_recommended','already_known','no_exact_spotify_match','new_matched_song','duplicate_in_batch','new_matched_song','batch_full']);assert.equal(audit[1].matchedBy,'isrc');assert.equal(audit[1].matchedTo.title,'Library');assert.equal(audit[0].stage,'before_lookup');assert.equal(audit[1].stage,'after_lookup');assert.equal(audit[6].outcome,'unused');
});
test('non-Latin song titles remain distinct in exclusion matching',async()=>{
 const known=[{title:'アイドル',artist:'YOASOBI'}],audit=[];const tracks=await selectDiscoveries([{title:'夜に駆ける',artist:'YOASOBI'}],known,async t=>({...t,uri:'fresh'}),1,audit);assert.equal(tracks.length,1);assert.equal(audit[0].outcome,'accepted');
});
