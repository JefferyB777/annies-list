import type { Metadata, Viewport } from "next";
import "@fontsource-variable/nunito";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Annie's List",
  description: "One grocery budget across every store. Scan, confirm the price, watch it count down.",
  applicationName: "Annie's List",
  appleWebApp: { capable: true, title: "Annie's List", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbf7ef",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
