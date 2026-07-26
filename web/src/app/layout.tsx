import type { Metadata } from "next";
import "./globals.css";

// No next/font/google here. That fetches from a remote host at build time, and
// this site is built on a box with no browser and a CSP that forbids remote
// fetches at runtime. System stacks only.

const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "VoiceQL: speak a data question, get a spoken answer",
  description:
    "A voice to SQL agent on an Arduino Uno R4 WiFi. Whisper transcribes, "
    + "Claude writes the SQL, SQLite answers, the board speaks. Playable in "
    + "your browser against the real sample database.",
  openGraph: {
    title: "VoiceQL",
    description:
      "Speak a data question. Get a spoken answer in under three seconds.",
    images: ["/media/social-card.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/media/social-card.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
