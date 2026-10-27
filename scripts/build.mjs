import {copyFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),out=new URL('dist/',root);
const generated=['callback.html','.nojekyll'];
const files=['index.html','app.css','app.js','catalog.js','spotify.js','config.js','discovery.js','history.js','recommendations.js','sw.js','manifest.webmanifest','icon.svg','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png','_headers'];
await mkdir(out,{recursive:true});await mkdir(new URL('icons/',out),{recursive:true});
for(const entry of await readdir(out,{withFileTypes:true})){if(!files.includes(entry.name)&&!generated.includes(entry.name)&&entry.name!=='icons')throw Error('Unexpected build output: '+entry.name+'; inspect it before deploying.');}
await Promise.all(files.map(name=>copyFile(new URL(name,root),new URL(name,out))));
await copyFile(new URL('index.html',root),new URL('callback.html',out));await writeFile(new URL('.nojekyll',out),'');
console.log(`Built ${files.length+generated.length} public assets in ${fileURLToPath(out)}. Personal data, credentials and backend source are excluded.`);
