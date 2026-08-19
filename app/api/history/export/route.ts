import { NextResponse } from "next/server";
import { getHistory } from "@/lib/history";
export async function GET(){
 const rows = await getHistory();
 const h = ["STT,File,Thoi gian,Tong loi,Da xu ly,Chua xu ly,Trang thai"];
 rows.forEach((r,i)=>h.push(`${i+1},"${r.filename}","${r.createdAt}",${r.totalIssues},${r.resolvedIssues},${r.pendingIssues},"${r.pendingIssues?"Chua hoan tat":"Da hoan tat"}"`));
 return new NextResponse("\ufeff"+h.join("\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=lich-su-soat-van-ban.csv"}});
}
