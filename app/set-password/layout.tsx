import type { Metadata } from "next";

// The setup token travels in the URL, so keep it out of any Referer header.
export const metadata: Metadata = { referrer: "no-referrer" };

export default function SetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
