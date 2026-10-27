const path=require('node:path');
let playwright;
try{playwright=require('playwright')}catch{playwright=require(path.join(process.env.USERPROFILE||'', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))}
module.exports={chromium:{launch:options=>playwright.chromium.launch({...options,channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'msedge':undefined)})}};
