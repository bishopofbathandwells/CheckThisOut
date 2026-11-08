const assert=require('node:assert/strict');const {chromium}=require('./test-browser.cjs');
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const account of [null,'friend','owner']){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();let calls=0,fail=false;
  if(account)await page.addInitScript(id=>sessionStorage.setItem('cto-spotify-session',JSON.stringify({access_token:id,refresh_token:'mock',expires:Date.now()+3600000})),account);
  await page.route('**/config.js',r=>r.fulfill({contentType:'text/javascript',body:"export const recommendationEndpoint='http://127.0.0.1:8766/recommend';export const developerSpotifyUserId='owner';"}));
  await page.route('https://api.spotify.com/v1/me',r=>r.fulfill({json:{id:account,display_name:account}}));
  await page.route('**/developer/usage',r=>{calls++;assert.equal(r.request().headers().authorization,'Bearer owner');assert.equal(r.request().method(),'GET');return r.fulfill(fail?{status:503,json:{error:'Usage unavailable'}}:{json:{users:[{userId:'owner',batchCount:17,latestBatch:'2026-11-08T15:00:00Z',lastSyncedAt:'2026-11-08T15:01:00Z'},{userId:'friend',batchCount:null,latestBatch:null,lastSyncedAt:null}]}})});
  await page.goto('http://127.0.0.1:8766/');await page.locator('#settings').click();assert.equal(calls,0);
  if(account!=='owner'){assert(await page.locator('#developer-tools').isHidden());await context.close();continue;}
  await page.locator('#developer-tools summary').click();await page.locator('#developer-usage').click();await page.locator('#developer-usage-results table').waitFor();assert.equal(calls,1);
  assert.match(await page.locator('#developer-usage-results').innerText(),/You/);assert.match(await page.locator('#developer-usage-results').innerText(),/17/);assert.match(await page.locator('#developer-usage-results').innerText(),/None synced/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fail=true;await page.locator('#developer-usage').click();await page.locator('#developer-usage-status').filter({hasText:'Usage unavailable'}).waitFor();assert.equal(await page.locator('#developer-usage-results table').count(),0);assert(await page.locator('#developer-usage').isEnabled());await context.close();
 }
 console.log('PASS developer usage: owner visibility, manual authenticated load, counts/dates, no-profile accounts, phone layout and error recovery. Normal/signed-out users make no usage calls.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
