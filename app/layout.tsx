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
  title: "DecktaGO Admin Dashboard",
  description: "Admin dashboard for inventory and delivery management",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ConditionalHtmlClass />
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
