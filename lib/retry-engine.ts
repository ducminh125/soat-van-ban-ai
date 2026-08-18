export type RetryReason='network'|'rate_limit'|'timeout'|'schema'|'unknown';

export function isTechnicalError(e:unknown){
 const m=String(e).toLowerCase();
 return m.includes("timeout")||m.includes("429")||m.includes("502")||m.includes("503")||m.includes("network");
}

export async function withRecovery<T>(
 primary:()=>Promise<T>,
 fallback:()=>Promise<T>
):Promise<T>{
 try{
   return await primary();
 }catch(e){
   if(isTechnicalError(e)) return fallback();
   throw e;
 }
}
