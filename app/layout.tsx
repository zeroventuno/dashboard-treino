import type { Metadata } from "next";
import { Saira, Archivo } from "next/font/google";
import "./globals.css";

// Display / headings / numbers — Saira (used italic).
const saira = Saira({
  variable: "--font-saira",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

// Body / UI text — Archivo.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Brand-only default: this is the root layout for every tenant, so naming one
// athlete's race here put "Costa Navarino 70.3" in a stranger's browser tab.
// Pages that know whose dashboard they are override it — `/` from RACE_NAME,
// `/app` from that tenant's next A race or active cycle.
export const metadata: Metadata = {
  title: "MY TRAKR",
  description: "Train. Track. Evolve. — the athlete's training dashboard.",
};

export const viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${saira.variable} ${archivo.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
