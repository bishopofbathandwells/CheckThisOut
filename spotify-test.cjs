const assert=require('node:assert/strict');
const {chromium}=require('./test-browser.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({serviceWorkers:'block'});
 await page.route('**/config.js',route=>route.fulfill({contentType:'text/javascript',body:"export const recommendationEndpoint='';"}));
 const playlists=[],items=new Map();let writes=0,failBatch=true,partialBatch=true,likes=0,tokenCalls=0,activeUser='test-user';
 await page.route('https://accounts.spotify.com/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/authorize'){assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:8766/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert(!url.searchParams.has('client_secret'));return route.fulfill({contentType:'text/html',body:'Mock Spotify approval'})}
  const data=new URLSearchParams(route.request().postData());assert(!data.has('client_secret'));assert(['authorization_code','refresh_token'].includes(data.get('grant_type')));tokenCalls++;
  return route.fulfill({json:{access_token:'test-token',refresh_token:'test-refresh',expires_in:3600}});
 });
 await page.route('https://api.spotify.com/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/v1',''),method=req.method();
  assert.equal(req.headers().authorization,'Bearer test-token');
  if(p==='/me')return route.fulfill({json:{id:activeUser,display_name:activeUser}});
  if(p==='/search'){const q=url.searchParams.get('q'),title=q.match(/track:"(.*?)"/)[1],artist=q.match(/artist:"(.*?)"/)[1];return route.fulfill({json:{tracks:{items:[{name:title==='Back On 74'?title+' (feat. Test Artist)':title,artists:[{name:artist}],uri:'spotify:track:'+encodeURIComponent(title),external_urls:{spotify:'https://open.spotify.com/track/test'}}]}}})}
  if(p==='/me/playlists'&&method==='GET')return route.fulfill({json:{items:playlists,next:null}});
  if(p==='/me/playlists'&&method==='POST'){const data=req.postDataJSON(),id='playlist-'+(playlists.length+1);playlists.push({...data,id,owner:{id:activeUser}});items.set(id,[]);return route.fulfill({status:201,json:{id}})}
  const match=p.match(/^\/playlists\/(.*?)\/items$/);
  if(match){const id=match[1];if(method==='GET')return route.fulfill({json:{items:(items.get(id)||[]).map(uri=>({item:{uri}})),next:null}});
   if(method==='PUT'){if(failBatch){failBatch=false;return route.fulfill({status:503,json:{error:'temporary'}})}items.set(id,partialBatch?req.postDataJSON().uris.slice(0,1):req.postDataJSON().uris);partialBatch=false;writes++;return route.fulfill({json:{snapshot_id:'test'}})}
   if(method==='POST'){items.get(id).push(...req.postDataJSON().uris);return route.fulfill({json:{snapshot_id:'test'}})}
  }
  if(p==='/me/library'&&method==='PUT'){likes++;return route.fulfill({status:200,body:''})}
  throw Error(`Unexpected API route: ${method} ${p}`);
 });
 await page.goto('http://127.0.0.1:8766');await page.locator('#spotify-connect').waitFor({state:'visible'});await page.locator('#spotify-connect').click();await page.waitForURL('https://accounts.spotify.com/authorize?**');
 // Return to the same origin and tab, as Spotify's redirect does.
 await page.goto('http://127.0.0.1:8766');const pending=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('cto-spotify-pkce')));
 const challenge=require('node:crypto').createHash('sha256').update(pending.verifier).digest('base64url');assert(challenge);
 await page.goto('http://127.0.0.1:8766/callback?code=test-code&state='+pending.state);
 await page.getByRole('status').filter({hasText:'Connected to test-user'}).waitFor();assert.equal(new URL(page.url()).pathname,'/');assert.equal(new URL(page.url()).search,'');assert.equal(tokenCalls,1);
 await page.locator('#generate').click();await page.getByRole('button',{name:'Save to Spotify',exact:true}).click();await page.getByRole('status').filter({hasText:'503'}).waitFor();assert.equal(playlists.length,1);
 await page.getByRole('button',{name:'Save to Spotify',exact:true}).click();await page.getByRole('status').filter({hasText:'expected five matching songs, found 1'}).waitFor();assert.equal(playlists.length,1);
 await page.getByRole('button',{name:'Save to Spotify',exact:true}).click();await page.getByRole('status').filter({hasText:'Five songs saved'}).waitFor();assert.equal(playlists.length,1);assert.equal(writes,2);assert.equal(items.get('playlist-1').length,5);
 await page.locator('#settings').click();await page.locator('#also-like').check();await page.locator('#save').click();await page.getByRole('status').filter({hasText:'preferences saved'}).waitFor();await page.locator('#settings').click();if(!await page.locator('#also-like').isChecked())throw Error('Liked Songs preference not saved');await page.getByRole('button',{name:'Close preferences'}).click();
 await page.getByRole('button',{name:'Keep Back On 74',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved to Keep and Spotify Liked Songs'}).waitFor();assert.equal(playlists.length,2);assert.equal(items.get('playlist-2').length,1);assert.equal(likes,1);
 await page.getByRole('button',{name:'Keep Back On 74',exact:true}).click();await page.getByRole('status').filter({hasText:'Already saved'}).waitFor();assert.equal(items.get('playlist-2').length,1);
 await page.evaluate(()=>{const data=JSON.parse(sessionStorage.getItem('cto-spotify-session'));data.expires=0;sessionStorage.setItem('cto-spotify-session',JSON.stringify(data))});await page.reload();await page.getByRole('status').filter({hasText:'Connected to test-user'}).waitFor();assert.equal(tokenCalls,2);
 activeUser='other-user';await page.reload();await page.getByRole('status').filter({hasText:'Connected to other-user'}).waitFor();assert.equal(await page.locator('.track').count(),0);assert.equal(await page.locator('#keep-count').textContent(),'0');
 await page.locator('#spotify-disconnect').click();await page.getByText('Your next discovery starts here.').waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('cto-spotify-session')),null);
 await page.goto('http://127.0.0.1:8766/callback?code=bad&state=wrong');await page.getByRole('status').filter({hasText:'could not be verified'}).waitFor();assert.equal(tokenCalls,2);
 console.log('PASS: PKCE callback, state rejection, refresh, account isolation, playlist retry, Keep deduplication, Liked Songs, disconnect. All Spotify requests mocked.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
