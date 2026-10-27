// Run against server.cjs. Uses the bundled Playwright and installed Edge.
const {chromium}=require('./test-browser.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto('http://127.0.0.1:8766');
 await page.getByText('Your next discovery starts here.').waitFor();
 await page.locator('#generate').click();await page.locator('.track').first().waitFor();
 if(await page.locator('.track').count()!==5)throw Error('Batch size');
 await page.getByRole('button',{name:'5 stars for Back On 74',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Rating saved'}).waitFor();
 await page.getByRole('button',{name:'Keep Back On 74',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Saved to demo keeps'}).waitFor();
 await page.reload();await page.locator('.track').first().waitFor();
 if(await page.getByRole('button',{name:'5 stars for Back On 74',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('Rating persistence');
 if(await page.locator('#keep-count').textContent()!=='1')throw Error('Keep persistence');
 await page.locator('#settings').click();await page.locator('#prompt').fill('Prefer newer songs, less jazz');await page.locator('#save').click();
 await page.getByRole('status').filter({hasText:'preferences saved'}).waitFor();
 await page.reload();await page.locator('#settings').click();
 if(await page.locator('#prompt').inputValue()!=='Prefer newer songs, less jazz')throw Error('Preference persistence');
 await page.getByRole('button',{name:'Close preferences'}).click();
 await page.locator('#generate').click();await page.getByText('Wildfires',{exact:true}).waitFor();
 await page.locator('#generate').click();await page.getByText('Run Your Mouth',{exact:true}).waitFor();
 await page.locator('#generate').click();await page.getByRole('status').filter({hasText:'all 15'}).waitFor();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 await page.screenshot({path:'prototype-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:1000});await page.screenshot({path:'prototype-desktop.png',fullPage:true});
 console.log('PASS: batches, ratings/keeps/preferences persist, no repeated demo tracks, mobile width');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
