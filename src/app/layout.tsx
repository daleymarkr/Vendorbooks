import type { Metadata } from "next";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VendorBooks", template: "%s · VendorBooks" },
  description:
    "Vendor payout statements for Square sellers. VendorBooks calculates commission and booth rent. The shop pays vendors directly.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const plausible = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <html lang="en">
      <head>{plausible ? <script defer data-domain={plausible} src="https://plausible.io/js/script.js" /> : null}</head>
      <body>{children}</body>
    </html>
  );
}
