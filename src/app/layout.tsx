import type { Metadata } from "next";
import { lineSeed } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "30 ปี ไอที: รีคอนเน็กต์",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={lineSeed.variable}>
      <body>{children}</body>
    </html>
  );
}
