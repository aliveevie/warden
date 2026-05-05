import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "Warden",
  description: "Sovereign AI financial agents on Solana",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
