const assert=require('node:assert/strict');
const {chromium}=require('./test-browser.cjs');
(async()=>{
 const {startMockServer}=await import('./backend/mock-server.mjs'),server=await startMockServer(0),endpoint=`http://127.0.0.1:${server.address().port}/recommend`;
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({serviceWorkers:'block'}),playlistItems=new Map();let nextId=0,requestCount=0,failDelete=true,deleteCalls=0;
 page.on('request',r=>{if(r.url()===endpoint){const body=r.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['batchSize','exclusions','playlistTracks','preferences','requestId']);assert.deepEqual(body.playlistTracks,[{title:'Seed Song',artist:'Seed Artist'}]);requestCount++}});
 await page.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:`export const recommendationEndpoint=${JSON.stringify(endpoint)};export const playlistContextEnabled=true;`}));
 await page.addInitScript(()=>sessionStorage.setItem('cto-spotify-session',JSON.stringify({access_token:'local-test-token',refresh_token:'mock-refresh',expires:Date.now()+3600000})));
 await page.route('https://api.spotify.com/v1/**',async route=>{
  const r=route.request(),url=new URL(r.url()),path=url.pathname.replace('/v1','');
  if(path==='/me')return route.fulfill({json:{id:'mock-user',display_name:'Local test account'}});
  if(path==='/me/tracks')return route.fulfill({json:{items:Array.from({length:12},(_,i)=>({track:{uri:'spotify:track:'+String(i).padStart(22,'0'),name:'Local Song '+i,artists:[{name:'Mock Soul Artist'}]}})),next:null}});
  if(path==='/me/player/recently-played')return route.fulfill({json:{items:[]}});
  if(path==='/search'){const q=url.searchParams.get('q'),name=q.match(/track:"(.*?)"/)[1],artist=q.match(/artist:"(.*?)"/)[1],i=Number(name.split(' ').at(-1));if(i===12)return route.fulfill({json:{tracks:{items:[]}}});return route.fulfill({json:{tracks:{items:[{name,artists:[{name:artist}],uri:'spotify:track:'+String(i).padStart(22,'0'),external_urls:{spotify:'https://open.spotify.com/track/mock'}}]}}})}
  if(path==='/me/playlists'&&r.method()==='GET')return route.fulfill({json:{items:[{id:'seed',name:'My music',owner:{id:'mock-user'}}],next:null}});
  if(path==='/playlists/seed/items')return route.fulfill({json:{items:[{item:{name:'Seed Song',artists:[{name:'Seed Artist'}],uri:'spotify:track:aaaaaaaaaaaaaaaaaaaaaa'}}],next:null}});
  if(path==='/me/playlists'&&r.method()==='POST'){const id='batch'+(++nextId);playlistItems.set(id,[]);return route.fulfill({status:201,json:{id}})}
  const match=path.match(/^\/playlists\/(.*?)\/items$/);if(match){const id=match[1];if(r.method()==='PUT'){playlistItems.set(id,r.postDataJSON().uris);return route.fulfill({json:{snapshot_id:'mock'}})}if(r.method()==='DELETE'){deleteCalls++;assert.equal(r.postDataJSON().items.length,1);if(failDelete){failDelete=false;return route.fulfill({status:503,json:{error:'temporary'}})}const uri=r.postDataJSON().items[0].uri;playlistItems.set(id,playlistItems.get(id).filter(t=>t!==uri));return route.fulfill({json:{snapshot_id:'mock'}})}return route.fulfill({json:{items:playlistItems.get(id).map(uri=>({item:{uri}})),next:null}})}
  throw Error('Unexpected Spotify route: '+path);
 });
 await page.goto('http://127.0.0.1:8766');await page.getByRole('status').filter({hasText:'Connected to'}).waitFor();
 await page.locator('#settings').click();await page.locator('#prompt').fill('Prefer soul');await page.locator('#save').click();await page.getByRole('status').filter({hasText:'preferences saved'}).waitFor();

 await page.locator('#settings').click();await page.locator('#batch-size').fill('10');await page.locator('#save').click();
 await page.locator('#discover').click();await page.getByRole('status').filter({hasText:'7 of 10 requested songs ready.'}).waitFor();assert.equal(await page.locator('.track').count(),7);assert.equal(playlistItems.size,0);
 await page.getByRole('button',{name:'Save to Spotify',exact:true}).click();await page.getByRole('status').filter({hasText:'7 songs saved to Spotify'}).waitFor();assert.equal(playlistItems.get('batch1').length,7);assert.equal(new Set(playlistItems.get('batch1')).size,7);await page.reload();await page.locator('#settings').click();assert.equal(await page.locator('#batch-size').inputValue(),'10');console.log('PASS partial batch retains seven discoveries, reports shortfall, saves seven Spotify tracks and preserves requested setting of ten; no real API calls');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
