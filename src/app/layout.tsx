import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIデータカタログ",
  description: "社内データセットの登録・検索・承認",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
