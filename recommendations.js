export function rememberRecommendations(profile){
 const ids=new Set(profile.recommendedIds||[]);
 for(const batch of profile.batches){batch.originalIds||=[...batch.ids];for(const id of batch.originalIds)ids.add(id)}
 profile.recommendedIds=[...ids];profile.nukedIds||=[];
 return profile.recommendedIds;
}
export function recordBatch(profile,batch){batch.originalIds=[...batch.ids];profile.batches.push(batch);rememberRecommendations(profile)}
export function removeFromBatch(profile,batch,id){
 rememberRecommendations(profile);batch.ids=batch.ids.filter(candidate=>candidate!==id);
 if(!profile.nukedIds.includes(id))profile.nukedIds.push(id);
 delete batch.pendingRemoval;
}

export function modelExclusions(tracks){
 const entries=new Map();for(const t of tracks){if(!t?.title||!t.artist)continue;for(const a of t.artists?.length?t.artists:[t.artist]){const title=t.title.slice(0,180).trim(),artist=a.slice(0,180).trim();if(title&&artist)entries.set(`${artist.normalize('NFKD').toLowerCase()}|${title.normalize('NFKD').toLowerCase()}`,{title,artist})}}
 const list=[...entries.values()];if(list.length>10000||JSON.stringify(list).length>600000)throw Error('Your exclusion list has exceeded the supported model context size. No model request was made.');return list;
}
