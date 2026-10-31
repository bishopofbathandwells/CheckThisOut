// Shared parsing only: no tokens or profile data are recorded here.
export async function spotifyThrottle(response,now=Date.now(),attempt=1){
 let detail;try{detail=await response.json()}catch{}
 const reason=detail?.error?.reason==='QUOTA_EXCEEDED'?'quota':'rate';
 const header=response.headers.get('Retry-After');let seconds=header&&/^\d+(?:\.\d+)?$/.test(header)?Number(header):header?Math.max(0,(Date.parse(header)-now)/1000):NaN;
 const provided=Number.isFinite(seconds);if(!provided)seconds=reason==='quota'?900:Math.min(900,60*2**Math.min(Math.max(attempt-1,0),4));
 return {reason,provided,retryAt:now+Math.max(1,Math.ceil(seconds))*1000,attempt};
}
export function spotifyThrottleMessage(limit,now=Date.now()){
 const seconds=Math.max(1,Math.ceil((limit.retryAt-now)/1000));
 if(limit.reason==='quota')return `Spotify reports that this app's API quota has been exhausted. ${limit.provided?`Spotify says to wait ${seconds} seconds.`:`Spotify did not provide a reset time; requests are paused locally for ${seconds} seconds.`} Repeated retries will not bypass this limit.`;
 return `Spotify rate limit reached. ${limit.provided?'Spotify says to wait':'Spotify did not provide a retry time; wait at least'} ${seconds} seconds. Requests are paused during this cooldown.`;
}
