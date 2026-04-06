import type React from "react"
import type { Metadata } from "next"
import { Inter, Roboto_Mono } from "next/font/google"
import { ConditionalLayout } from "@/components/layout/conditional-layout"
import { ConditionalHtmlClass } from "@/components/layout/conditional-html-class"
import "./globals.css"

const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
})

const geistMono = Roboto_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "DecktaGO — Main Dashboard",
  description: "Monitor inventory flow and stock status in real time",
  generator: "v0.app",
}

// Anti-flicker script: runs before React hydrates to set the correct theme class
// on <html> immediately. Prevents the flash of dark/light before next-themes loads.
const themeInitScript = `
(function() {
  try {
    var theme = localStorage.getItem('theme');
    // Default to light if no theme stored or if stored value isn't valid
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        <ConditionalHtmlClass />
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
