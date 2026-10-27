// Local-only test harness. Never deploy this file. No real model or Spotify calls.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createWorker,RecommendationBudget} from './worker.mjs';
class MemoryStorage {
 data=new Map();queue=Promise.resolve();
 async get(k){return structuredClone(this.data.get(k))}
 async put(k,v){this.data.set(k,structuredClone(v))}
 async transaction(fn){const previous=this.queue;let release;this.queue=new Promise(resolve=>release=resolve);await previous;try{return await fn(this)}finally{release()}}
}
export async function startMockServer(port=8787){
 const env={ENABLED:'true',OPENAI_API_KEY:'mock-only-not-a-key',OPENAI_MODEL:'gpt-6-luna',ALLOWED_ORIGINS:'http://127.0.0.1:8766',ALLOWED_SPOTIFY_USERS:'mock-user'};
 const fetcher=async(url,options)=>{
  if(url==='https://api.spotify.com/v1/me')return options.headers.Authorization==='Bearer local-test-token'?Response.json({id:'mock-user'}):new Response('',{status:401});
  if(url!=='https://api.openai.com/v1/responses')throw Error('Unexpected mock destination');
  const preferences=JSON.parse(JSON.parse(options.body).input).listener_preferences;
  const songs=Array.from({length:JSON.parse(options.body).text.format.schema.properties.songs.minItems},(_,i)=>({title:`Local Song ${i}`,artist:preferences.includes('soul')?'Mock Soul Artist':'Mock Artist'}));
  return Response.json({usage:{input_tokens:2500,output_tokens:500,input_tokens_details:{cached_tokens:500},total_tokens:3000},status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({songs})}]}]});
 };
 const budget=new RecommendationBudget({storage:new MemoryStorage()},env,fetcher);env.BUDGET={idFromName:n=>n,get:()=>budget};const worker=createWorker(fetcher);
 const server=http.createServer(async(req,res)=>{try{
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8388608){res.writeHead(413).end();return}chunks.push(chunk)}
  const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500).end('Mock server error')}});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const server=await startMockServer();console.log(`Mock-only recommendation Worker: http://127.0.0.1:${server.address().port} (no real API calls; test credentials only)`)}
