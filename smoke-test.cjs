const assert=require('node:assert/strict');
const {chromium}=require('./test-browser.cjs');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:360,height:640},serviceWorkers:'block'});
 await page.goto('http://127.0.0.1:8766');await page.getByText('Your next discovery starts here.').waitFor();
 assert.equal(await page.locator('#generate').count(),0);assert.equal(await page.locator('.track').count(),0);
 assert(await page.getByRole('button',{name:'Connect Spotify',exact:true}).isVisible());assert(!(await page.locator('#discover').isVisible()));
 for(const theme of ['precision','paper','studio']){await page.locator('#settings').click();await page.locator('#theme-choice').selectOption(theme);await page.locator('#prompt').fill('Prefer newer songs, less jazz');await page.locator('#save').click();await page.locator('#preferences').waitFor({state:'hidden'});await page.reload();await page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#settings').click();assert.equal(await page.locator('#prompt').inputValue(),'Prefer newer songs, less jazz');assert(await page.locator('#save').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));await page.getByRole('button',{name:'Close preferences',exact:true}).click();}
 await page.route('https://accounts.spotify.com/authorize**',r=>r.fulfill({contentType:'text/html',body:'Spotify sign-in test'}));await page.getByRole('button',{name:'Connect Spotify',exact:true}).click();await page.getByText('Spotify sign-in test',{exact:true}).waitFor();
 console.log('PASS sign-in replaces demo generation; all themes fit phone width; preferences persist; main button starts Spotify OAuth.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
