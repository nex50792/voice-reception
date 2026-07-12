import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "voice-reception",
  description: "電話の一次受けを想定した、ブラウザで動く音声予約受付のデモ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
