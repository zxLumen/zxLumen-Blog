import type { Metadata } from "next";
import "@zx/shared/styles.css";
import {
  NAV,
  NAV_INIT_SCRIPT,
  SITE_META,
  themeInitScript,
  THEME_IDS,
  LAYOUT_IDS,
  LIVE_THEME_IDS,
  LIVE_LAYOUT_IDS,
  FEATURE_IDS,
  LIVE_FEATURES,
} from "@zx/shared";
import { isAdmin } from "@/lib/auth";
import { isTestMode } from "@/lib/env";
import { getClientContacts } from "@/lib/settings";
import { EnvSwitch } from "@/components/EnvSwitch";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: SITE_META.title,
  description: SITE_META.description,
  keywords: SITE_META.keywords,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const admin = await isAdmin();
  const testMode = await isTestMode();
  const contacts = getClientContacts();

  // 正式环境只放行精简集;测试模式放行全部主题/布局/功能
  const allowedThemeIds = testMode ? THEME_IDS : LIVE_THEME_IDS;
  const allowedLayoutIds = testMode ? LAYOUT_IDS : LIVE_LAYOUT_IDS;
  const allowedFeatures = testMode ? [...FEATURE_IDS] : LIVE_FEATURES;

  const nav = admin ? [...NAV, { label: "admin", href: "/admin" }] : NAV;
  const initScript = `${themeInitScript(allowedThemeIds, allowedLayoutIds)};${NAV_INIT_SCRIPT}`;

  return (
    <html lang="zh-CN" data-theme="github-light" data-layout="sidebar" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>
        <AppShell
          nav={nav}
          contacts={contacts}
          allowedThemeIds={allowedThemeIds}
          allowedLayoutIds={allowedLayoutIds}
          allowedFeatures={allowedFeatures}
          extra={admin ? <EnvSwitch testMode={testMode} /> : null}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
