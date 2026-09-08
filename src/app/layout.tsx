import type { Metadata } from "next";
import { Oswald, Playfair_Display, Source_Serif_4, Geist_Mono } from "next/font/google";
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

/*
 * The Gazette's masthead and headlines, and nowhere else.
 *
 * Oswald is a condensed gothic, which is Sports Illustrated rather than a paper
 * of record — every broadsheet sets its headlines in a serif (the Times in
 * Cheltenham, the Journal in Escrow). Scoping a display serif to the Gazette
 * routes gets that voice without touching the draft board's identity, which is
 * deliberately a sports page and should stay one.
 */
const playfair = Playfair_Display({
  variable: "--font-gazette",
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
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
      className={`${oswald.variable} ${playfair.variable} ${sourceSerif.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Applies the saved theme BEFORE first paint. This has to be a blocking
          inline script in <head>: doing it in an effect runs after paint, which
          is a visible flash of the wrong theme on every single load.

          No stored value means no attribute, which leaves `color-scheme:
          light dark` in globals.css to follow the OS.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {/*
          The first focusable thing on every page, and invisible until it is
          focused. Every header opens with the wordmark and three section
          menus, so reaching the actual content by keyboard costs four tab
          stops on every single navigation — and the Gazette and the history
          tables are long enough that the cost is paid repeatedly.

          `sr-only focus:not-sr-only` is the standard shape: it stays in the
          accessibility tree and the tab order at all times and only takes up
          space once focused, so it is never a stray blank row above the
          header for everybody else.

          It targets `#main`, which is on the `<main>` of every page. Several
          pages have more than one — a loading fallback and the real thing —
          but they are alternate branches, so only one is ever in the document.
        */}
        <a
          href="#main"
          className="sr-only rounded-md focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-amber-300 focus:px-3 focus:py-2 focus:font-display focus:text-xs focus:font-bold focus:uppercase focus:tracking-[0.08em] focus:text-slate-950"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
