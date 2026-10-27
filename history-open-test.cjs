const assert=require('node:assert/strict');
const {chromium}=require('./test-browser.cjs');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({serviceWorkers:'block'});await page.goto('http://127.0.0.1:8766');await page.getByText('Your next discovery starts here.').waitFor();await page.locator('#generate').click();await page.locator('.track').nth(4).waitFor();await page.locator('#generate').click();await page.getByText('Wildfires',{exact:true}).waitFor();await page.locator('[data-view=history]').click();
 const older=page.locator('#collection details').nth(1),newer=page.locator('#collection details').nth(0);
 await older.locator('summary').click();
 const check=async()=>{assert(await older.evaluate(d=>d.open));assert(!(await newer.evaluate(d=>d.open)))};
 await older.getByRole('button',{name:'4 stars for Back On 74',exact:true}).click();await page.getByRole('status').filter({hasText:'Rating saved'}).waitFor();await check();assert.equal(await older.getByRole('button',{name:'4 stars for Back On 74',exact:true}).getAttribute('aria-pressed'),'true');
 await older.getByRole('button',{name:'Keep Back On 74',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved to demo keeps'}).waitFor();await check();
 await older.getByRole('button',{name:'Remove Back On 74 from this batch',exact:true}).click();await page.getByRole('status').filter({hasText:'stays excluded'}).waitFor();await check();assert.equal(await older.locator('.track').count(),4);
 await newer.locator('summary').click();await older.getByRole('button',{name:/^3 stars for /}).first().click();await page.getByRole('status').filter({hasText:'Rating saved'}).waitFor();assert(await older.evaluate(d=>d.open));assert(await newer.evaluate(d=>d.open));
 await older.locator('summary').click();await newer.getByRole('button',{name:/^2 stars for /}).first().click();await page.getByRole('status').filter({hasText:'Rating saved'}).waitFor();assert(!(await older.evaluate(d=>d.open)));assert(await newer.evaluate(d=>d.open));
 console.log('PASS previous batch remains open after rating, Keep and Remove actions; multiple expanded/collapsed states preserved');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
