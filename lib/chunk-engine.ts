export type DocumentSegment={id:string;text:string};
export function splitLegalSegments(text:string):DocumentSegment[]{
 const parts=text.split(/(?=\b(?:Chương|Điều)\s+\d+)/i).map(s=>s.trim()).filter(Boolean);
 return parts.map((text,i)=>({id:`SEG_${i+1}`,text}));
}
