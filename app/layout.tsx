import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soát Văn Bản AI v0.9.9",
  description: "Rà soát Word bằng AI với quota và thống kê sử dụng"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
