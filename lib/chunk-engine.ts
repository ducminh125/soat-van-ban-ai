export type DocumentSegment={id:string;text:string;title?:string};

function splitByLegalStructure(text:string){
  return text
    .split(/(?=\b(?:Chương|Điều)\s+\d+(?:\s|\.))/i)
    .map(s=>s.trim())
    .filter(Boolean);
}

export function splitLegalSegments(text:string):DocumentSegment[]{
  const parts=splitByLegalStructure(text);
  return parts.map((text,i)=>({
    id:`SEG_${i+1}`,
    text,
    title:(text.match(/^(Chương|Điều)[^\n]*/i)?.[0] || `Segment ${i+1}`).trim()
  }));
}
