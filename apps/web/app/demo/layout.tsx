import { Suspense } from "react";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  // No auth check — demo page is public
  return <Suspense>{children}</Suspense>;
}

// Force dynamic rendering — demo page uses cookies + searchParams
export const dynamic = "force-dynamic";

