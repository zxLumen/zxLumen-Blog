"use client";

import dynamic from "next/dynamic";

const LuminariFloats = dynamic(() => import("./LuminariFloats").then((m) => m.LuminariFloats), {
  ssr: false,
});

export function LuminariFloatsClient() {
  return <LuminariFloats />;
}
