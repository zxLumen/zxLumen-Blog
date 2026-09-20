import type { Metadata } from "next";
import "@zx/shared/styles.css";
import { Shell } from "@zx/shared/ui";
import { NAV, SITE_META, THEME_INIT_SCRIPT } from "@zx/shared";
import { isAdmin } from "@/lib/auth";
import { isTestMode } from "@/lib/env";
import { EnvSwitch } from "@/components/EnvSwitch";

export const metadata: Metadata = {
  title: SITE_META.title,
  description: SITE_META.description,
  keywords: SITE_META.keywords,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const admin = await isAdmin();
  const testMode = await isTestMode();
  const nav = admin ? [...NAV, { label: "admin", href: "/admin" }] : NAV;

  return (
    <html lang="zh-CN" data-theme="github-light" data-layout="sidebar" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Shell nav={nav} extra={admin ? <EnvSwitch testMode={testMode} /> : null}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
