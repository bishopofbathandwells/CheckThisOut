const assert=require('node:assert/strict');const {chromium}=require('./test-browser.cjs');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let cloud={revision:0,profile:null},modelCalls=0;
 await page.addInitScript(()=>sessionStorage.setItem('cto-spotify-session',JSON.stringify({access_token:'private-test-token',refresh_token:'private-refresh',expires:Date.now()+3600000})));
 await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:"export const recommendationEndpoint='http://127.0.0.1:8766/recommend';export const cloudSyncEnabled=true;"}));
 await page.route('https://api.spotify.com/v1/**',r=>new URL(r.request().url()).pathname==='/v1/me'?r.fulfill({json:{id:'diagnostic-user'}}):r.abort('failed'));
 await page.route('**/profile',r=>{if(r.request().method()==='GET')return r.fulfill({json:cloud});const body=r.request().postDataJSON();if(body.revision!==cloud.revision)return r.fulfill({status:409,json:{conflict:true,...cloud}});cloud={revision:cloud.revision+1,profile:body.profile,updatedAt:new Date().toISOString()};return r.fulfill({json:{revision:cloud.revision,updatedAt:cloud.updatedAt}})});
 await page.route('**/recommend',r=>{modelCalls++;return r.fulfill({status:500,json:{error:'Unexpected model request'}})});
 const until=async check=>{const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw Error('Diagnostic did not sync');await new Promise(r=>setTimeout(r,50))}};
 await page.goto('http://127.0.0.1:8766/');await page.locator('#discover').waitFor();await until(()=>cloud.profile);await page.locator('#discover').click();await page.locator('#status').filter({hasText:'reading Liked Songs (GET /me/tracks)'}).waitFor();await until(()=>cloud.profile.requestLog?.some(x=>x.errorCode==='SPOTIFY_NETWORK_ERROR'));
 assert.equal(modelCalls,0);let diagnostic=cloud.profile.requestLog.find(x=>x.kind==='spotify-error');assert.equal(diagnostic.spotifyEndpoint,'/me/tracks');assert.equal(diagnostic.modelRequested,false);
 const message=await page.evaluate(async()=>{try{const spotify=await import('./spotify.js');await spotify.api('/playlists/private-playlist-id/items?secret=private-query')}catch(e){return e.message}});assert(message.includes('/playlists/:id/items'));assert(!message.includes('private-playlist-id'));await until(()=>cloud.profile.requestLog.filter(x=>x.kind==='spotify-error').length===2);
 const data=JSON.stringify(cloud.profile);for(const secret of ['private-test-token','private-refresh','private-playlist-id','private-query'])assert(!data.includes(secret));
 await page.locator('#settings').click();assert.match(await page.locator('#usage-summary').textContent(),/No request usage logged yet/);
 console.log('PASS Spotify network failure identifies operation, syncs sanitized diagnostic, omits credentials/query/playlist IDs, makes no model call and leaves model cost summary unchanged.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
