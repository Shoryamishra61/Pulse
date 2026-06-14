import type { Metadata } from "next";
import "./globals.css";
import AppLayout from "@/components/AppLayout";

export const metadata: Metadata = {
  title: "PULSE — AI-Native Campaign Intelligence",
  description: "Campaign intelligence surface that translates marketing intent into measurable customer outcomes. Built with production-grade architecture: Accept-then-Queue webhooks, Unidirectional State Machine, and Text-to-SQL Agentic Pipeline.",
  keywords: ["CRM", "AI", "Campaign Management", "Customer Intelligence", "Marketing Automation"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppLayout>
          {children}
        </AppLayout>
      </body>
    </html>
  );
}
