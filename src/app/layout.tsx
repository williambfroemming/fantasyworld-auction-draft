import type { Metadata } from "next";
import { Oswald, Source_Serif_4, Geist_Mono } from "next/font/google";
import "./globals.css";

/*
 * Three voices, the way a sports page has three:
 *   Oswald         condensed gothic — headlines, labels, anything in caps
 *   Source Serif 4 body copy and the board itself
 *   Geist Mono     agate: the figures that have to line up
 *
 * The previous setup loaded Geist Sans and Geist Mono, then `globals.css`
 * overrode `body` with `Arial, Helvetica, sans-serif` — leftover
 * create-next-app boilerplate, so both faces downloaded and neither rendered.
 */
const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fantasyworld Auction Draft",
  description:
    "Live auction draft board and season archive for a 10-person fantasy football league.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} ${sourceSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
