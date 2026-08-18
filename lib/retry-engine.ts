export type RetryReason='network'|'rate_limit'|'timeout'|'schema'|'unknown';
export async function withRecovery<T>(primary:()=>Promise<T>, fallback:()=>Promise<T>, isTechnical:(e:unknown)=>boolean):Promise<T>{try{return await primary()}catch(e){if(isTechnical(e)) return fallback(); throw e}}
