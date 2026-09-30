import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getToolConfig } from "@/lib/tool-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const config = await getToolConfig();
  return {
    title: `${config.name} | Pradem`,
    description: config.description,
  };
}

/**
 * Layout raíz de la herramienta satélite.
 * Los metadatos (title, description) se leen automáticamente de Supabase vía TOOL_SLUG.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
        {children}
      </body>
    </html>
  );
}
