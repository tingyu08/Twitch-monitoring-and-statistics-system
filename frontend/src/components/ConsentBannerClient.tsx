"use client";

import dynamic from "next/dynamic";

const ConsentBannerWrapper = dynamic(
  () => import("@/features/privacy/components/ConsentBanner").then((mod) => mod.ConsentBannerWrapper),
  { ssr: false }
);

export function ConsentBannerClient() {
  return <ConsentBannerWrapper />;
}
