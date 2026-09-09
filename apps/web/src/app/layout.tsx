import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RunCoach AI",
  description: "AI-powered training dashboard for runners",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
