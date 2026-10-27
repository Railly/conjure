import type { Metadata } from "next";
import { Bricolage_Grotesque, Gaegu, Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["600", "800"] });
const gaegu = Gaegu({ variable: "--font-gaegu", subsets: ["latin"], weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "Conjure",
  description: "Draw something. Play it. Muse turns your drawing into a game and changes it while you play.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" suppressHydrationWarning className={`${inter.variable} ${bricolage.variable} ${gaegu.variable} h-full antialiased`}>
      <body className="relative min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
