 "use client";

import { useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState("");

  async function review() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/review", {
      method: "POST",
      body: form,
    });

    const data = await res.json();
    setResult(JSON.stringify(data, null, 2));
  }

  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: 20 }}>
      <h1>Soát Văn Bản AI</h1>
      <p>Tải file Word/PDF để AI kiểm tra chính tả, diễn đạt và chất lượng văn bản.</p>

      <input
        type="file"
        accept=".doc,.docx,.pdf,.txt"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <br /><br />

      <button onClick={review} disabled={!file}>
        Bắt đầu soát văn bản
      </button>

      {file && <p>File: {file.name}</p>}

      {result && (
        <>
          <h2>Kết quả</h2>
          <pre>{result}</pre>
        </>
      )}
    </main>
  );
}
