import { Ga4Init } from "./ga4-init";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Ga4Init />
        {children}
      </body>
    </html>
  );
}
