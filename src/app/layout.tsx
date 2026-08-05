import type { Metadata } from "next";
import { lineSeed } from "./fonts";
import "./globals.css";

const title = "30 ปี ไอที: รีคอนเน็กต์";
const description =
  "ขอเชิญร่วมย้อนวันวาน สืบสานความผูกพัน ภาควิชาเทคโนโลยีสารสนเทศ (Theme: 2499 อันธพาลครองเมือง) — 19 กันยายน 2569 ณ ห้องพวงแสด";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://elite.fitm.kmutnb.ac.th"
  ),
  title,
  description,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "th_TH",
    siteName: title,
    title,
    description,
    images: [{ url: "/images/front.jpg", alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/images/front.jpg"],
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
