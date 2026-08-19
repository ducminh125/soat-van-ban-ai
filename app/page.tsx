"use client";
import { useState } from "react";

export default function Home(){
 const [file,setFile]=useState<File|null>(null);
 const [loading,setLoading]=useState(false);
 const [result,setResult]=useState("");
 async function submit(){
  if(!file)return;
  setLoading(true); setResult("");
  const fd=new FormData(); fd.append("file",file);
  const r=await fetch('/api/review',{method:'POST',body:fd});
  const d=await r.json();
  setResult(d.result || d.error || JSON.stringify(d));
  setLoading(false);
 }
 return <main style={{maxWidth:900,margin:'40px auto',padding:20}}>
  <h1>Soát Văn Bản AI</h1>
  <p>Tải file Word, PDF hoặc TXT để AI kiểm tra chính tả, diễn đạt và đề xuất chỉnh sửa.</p>
  <input type="file" accept=".docx,.pdf,.txt,.doc" onChange={e=>setFile(e.target.files?.[0]||null)}/>
  <p>{file?.name}</p>
  <button disabled={!file||loading} onClick={submit}>{loading?'Đang xử lý...':'Bắt đầu soát văn bản'}</button>
  {result && <pre style={{whiteSpace:'pre-wrap',marginTop:30}}>{result}</pre>}
 </main>
}
