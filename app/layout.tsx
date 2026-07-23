import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og-v5.png`;
  return {
    title: "Hostel Operations | Internal Management System",
    description: "Connected room availability, reservations, unit owners, students, parking, maintenance, billing, announcements and reports across five hostels.",
    openGraph: { title: "Hostel Operations", description: "Rooms, residents, maintenance and billing in one private operations system.", images: [image] },
    twitter: { card: "summary_large_image", title: "Hostel Operations", description: "Rooms, residents, maintenance and billing in one private operations system.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
