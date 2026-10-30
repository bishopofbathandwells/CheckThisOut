const assert=require('node:assert/strict');
const {chromium}=require('./test-browser.cjs');
(async()=>{
 const {startMockServer}=await import('./backend/mock-server.mjs'),server=await startMockServer(0),endpoint=`http://127.0.0.1:${server.address().port}/recommend`;
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({serviceWorkers:'block'}),playlistItems=new Map();let nextId=0,requestCount=0,failDelete=true,deleteCalls=0,playlistReads=0;
 page.on('request',r=>{if(r.url()===endpoint){const body=r.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['batchSize','exclusions','playlistTracks','preferences','requestId']);assert.deepEqual(body.playlistTracks,[{title:'Seed Song',artist:'Seed Artist'}]);if(requestCount===1)assert(body.exclusions.some(t=>t.title==='Local Song 1'));requestCount++}});
 await page.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:`export const recommendationEndpoint=${JSON.stringify(endpoint)};export const playlistContextEnabled=true;`}));
 await page.addInitScript(()=>sessionStorage.setItem('cto-spotify-session',JSON.stringify({access_token:'local-test-token',refresh_token:'mock-refresh',expires:Date.now()+3600000})));
 await page.route('https://api.spotify.com/v1/**',async route=>{
  const r=route.request(),url=new URL(r.url()),path=url.pathname.replace('/v1','');
  if(path==='/me')return route.fulfill({json:{id:'mock-user',display_name:'Local test account'}});
  if(path==='/me/tracks')return route.fulfill({json:{items:[{track:{uri:'spotify:track:'+String(0).padStart(22,'0'),name:'Local Song 0',artists:[{name:'Mock Soul Artist'}]}}],next:null}});
  if(path==='/me/player/recently-played')return route.fulfill({json:{items:[]}});
  if(path==='/search'){const q=url.searchParams.get('q'),name=q.match(/track:"(.*?)"/)[1],artist=q.match(/artist:"(.*?)"/)[1],i=Number(name.split(' ').at(-1));return route.fulfill({json:{tracks:{items:[{name,artists:[{name:artist}],uri:'spotify:track:'+String(i).padStart(22,'0'),external_urls:{spotify:'https://open.spotify.com/track/mock'}}]}}})}
  if(path==='/me/playlists'&&r.method()==='GET')return route.fulfill({json:{items:[{id:'seed',name:'My music',owner:{id:'mock-user'}}],next:null}});
  if(path==='/playlists/seed/items'){playlistReads++;return route.fulfill({json:{items:[{item:{name:'Seed Song',artists:[{name:'Seed Artist'}],uri:'spotify:track:aaaaaaaaaaaaaaaaaaaaaa'}}],next:null}});}
  if(path==='/me/playlists'&&r.method()==='POST'){const id='batch'+(++nextId);playlistItems.set(id,[]);return route.fulfill({status:201,json:{id}})}
  const metadata=path.match(/^\/playlists\/([^/]+)$/);if(metadata&&r.method()==='GET')return route.fulfill({json:{name:'My Spotify '+metadata[1]}});
  const match=path.match(/^\/playlists\/(.*?)\/items$/);if(match){const id=match[1];if(r.method()==='PUT'){playlistItems.set(id,r.postDataJSON().uris);return route.fulfill({json:{snapshot_id:'mock'}})}if(r.method()==='DELETE'){deleteCalls++;assert.equal(r.postDataJSON().items.length,1);if(failDelete){failDelete=false;return route.fulfill({status:503,json:{error:'temporary'}})}const uri=r.postDataJSON().items[0].uri;playlistItems.set(id,playlistItems.get(id).filter(t=>t!==uri));return route.fulfill({json:{snapshot_id:'mock'}})}return route.fulfill({json:{items:playlistItems.get(id).map(uri=>({item:{uri}})),next:null}})}
  throw Error('Unexpected Spotify route: '+path);
 });
 await page.goto('http://127.0.0.1:8766');await page.getByRole('status').filter({hasText:'Connected to'}).waitFor();
 await page.locator('#settings').click();await page.locator('#prompt').fill('Prefer soul');await page.locator('#save').click();await page.getByRole('status').filter({hasText:'preferences saved'}).waitFor();
 await page.locator('#discover').click();await page.getByRole('status').filter({hasText:'5 songs ready.'}).waitFor();assert.equal(playlistItems.size,0);
 await page.getByRole('button',{name:'Save to Spotify',exact:true}).click();await page.getByRole('status').filter({hasText:'Five songs saved to Spotify'}).waitFor();
 assert.equal(await page.locator('.track').count(),5);assert.equal(await page.getByText('Local Song 0',{exact:true}).count(),0);assert.equal(playlistItems.size,1);assert.equal(playlistItems.get('batch1').length,5);
 await page.getByRole('button',{name:'4 stars for Local Song 2',exact:true}).click();await page.getByRole('status').filter({hasText:'Rating saved'}).waitFor();await page.reload();await page.getByText('Local Song 2',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'4 stars for Local Song 2',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Remove Local Song 1 from this batch',exact:true}).click();await page.getByRole('status').filter({hasText:'503'}).waitFor();assert.equal(await page.locator('.track').count(),5);assert.equal(playlistItems.get('batch1').length,5);
 await page.getByRole('button',{name:'Remove Local Song 1 from this batch',exact:true}).click();await page.getByRole('status').filter({hasText:'stays excluded'}).waitFor();assert.equal(await page.locator('.track').count(),4);assert.equal(playlistItems.get('batch1').length,4);assert.equal(deleteCalls,2);
 await page.reload();await page.getByText('Local Song 2',{exact:true}).waitFor();assert.equal(await page.getByText('Local Song 1',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Save to Spotify',exact:true}).click();await page.getByRole('status').filter({hasText:'already saved'}).waitFor();assert.equal(playlistItems.size,1);
 await page.locator('#discover').click();await page.getByRole('status').filter({hasText:'5 songs ready.'}).waitFor();assert.equal(playlistItems.size,1);
 assert.equal(await page.getByText('Local Song 1',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Remove Local Song 6 from this batch',exact:true}).click();await page.getByRole('status').filter({hasText:'stays excluded'}).waitFor();assert.equal(await page.locator('.track').count(),4);assert.equal(deleteCalls,2);assert.equal(playlistItems.size,1);
 await page.context().route('https://open.spotify.com/**',route=>route.fulfill({contentType:'text/html',body:'Mock Spotify playlist'}));
 const popupEvent=page.waitForEvent('popup');await page.getByRole('button',{name:'Open in Spotify',exact:true}).click();const popup=await popupEvent;await popup.waitForURL('https://open.spotify.com/playlist/batch2');await page.getByRole('status').filter({hasText:'4 songs saved to Spotify'}).waitFor();assert.equal(playlistItems.size,2);assert.equal(playlistItems.get('batch2').length,4);assert(playlistItems.get('batch2').every(uri=>!playlistItems.get('batch1').includes(uri)));assert.equal(requestCount,2);assert.equal(playlistReads,2);await page.evaluate(async()=>{const s=await import('/spotify.js');await s.playlistContext();await s.playlistContext()});assert.equal(playlistReads,2);await popup.close();
 for(const i of [7,8,9,10]){const remove=page.getByRole('button',{name:`Remove Local Song ${i} from this batch`,exact:true});await remove.click();await remove.waitFor({state:'detached'});await page.getByRole('status').filter({hasText:'stays excluded'}).waitFor()}
 assert.equal(playlistItems.get('batch2').length,0);assert.equal(await page.locator('.track').count(),0);await page.getByText('This batch is empty.',{exact:true}).waitFor();
 await page.locator('#settings').click();await page.locator('#request-tools summary').click();await page.locator('#view-decisions').click();await page.getByRole('heading',{name:'Song decisions',exact:true}).waitFor();assert((await page.locator('#decisions-content details').first().locator('summary').innerText()).includes('12 candidates: 5 accepted, 6 rejected, 1 unused'));assert.equal(await page.locator('#decisions-content details').first().getByText('Previously recommended',{exact:true}).count(),5);await page.getByRole('button',{name:'Close song decisions'}).click();
 await page.locator('#export').click();const backup=JSON.parse(await page.locator('#export-data').inputValue());assert.equal(backup.recommendedIds.length,10);assert.equal(backup.nukedIds.length,6);assert.equal(backup.batches[1].originalIds.length,5);assert.equal(backup.batches[1].ids.length,0);await page.getByRole('button',{name:'Close export'}).click();
 await page.reload();await page.getByText('This batch is empty.',{exact:true}).waitFor();await page.locator('#settings').click();await page.locator('#request-tools summary').click();assert((await page.locator('#usage-summary').innerText()).includes('2 logged requests'));assert((await page.locator('#usage-summary').innerText()).includes('$0.000910'));
 await page.locator('#export-usage').click();const usageCsv=await page.locator('#export-data').inputValue();assert(usageCsv.includes('cachedInputTokens'));assert(usageCsv.includes('0.000455'));assert.equal(usageCsv.split('\n').length,3);await page.getByRole('button',{name:'Close export'}).click();
 await page.locator('[data-view=history]').click();await page.locator('#collection summary').filter({hasText:'My Spotify batch1'}).waitFor();await page.locator('#collection summary').filter({hasText:'My Spotify batch2'}).waitFor();
 await page.screenshot({path:'discovery-local-test.png',fullPage:true});
 console.log('PASS: explicit playlist saves/open, saved and unsaved removals, failed-delete retry, empty/trimmed batches, permanent no-repeat history and backup retention. No live services called.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exit(1)});
