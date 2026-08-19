import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PSY Foundation — Procedural Psytrance Synthesis Engine",
  description:
    "An offline TypeScript DSP engine that renders psytrance-style audio to WAV via HTTP API, built on a 13-package musical foundation. In development — not commercial-ready.",
  keywords: [
    "psytrance",
    "synthesis",
    "DSP",
    "ZDF SVF",
    "LUFS",
    "music",
    "procedural",
    "TypeScript",
  ],
  authors: [{ name: "PSY Foundation" }],
  openGraph: {
    title: "PSY Foundation",
    description: "Procedural psytrance synthesis engine (in development)",
    siteName: "PSY Foundation",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PSY Foundation",
    description: "Procedural psytrance synthesis engine (in development)",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
