import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Options Lab · TXO Calculator",
  description: "TXO options strategy calculator with P&L surface, Greeks, and IV tooling",
};

export const viewport: Viewport = {
  width: 1440,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
