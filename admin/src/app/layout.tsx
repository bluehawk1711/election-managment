import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppTheme } from "./theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The roll, the voter slip and half the panel's own labels are Devanagari;
// Geist carries no matras, so without this the Hindi text falls back to
// whatever the OS has and the slip prints in a font nobody chose. Loaded as
// a variable so it can ride the body stack beside Geist instead of
// replacing it — Latin keeps its face, Devanagari gets its own.
const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Campaign HQ",
    template: "%s · Campaign HQ",
  },
  description:
    "Admin console for the election campaign — voter roll, team accounts, tasks and the shared phone board.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // next-themes writes `class="light|dark"` on <html> before first paint;
    // letting React own that attribute would make hydration complain.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoDevanagari.variable} antialiased`}
      >
        <AppTheme>
          <Providers>{children}</Providers>
        </AppTheme>
      </body>
    </html>
  );
}