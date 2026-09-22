import type { Metadata } from "next";
import { cookies } from "next/headers";
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
import { isTestMode, testModeAvailable } from "@/lib/env";
import { getClientContacts } from "@/lib/settings";
import { EnvSwitch } from "@/components/EnvSwitch";
import { MockUserSwitch } from "@/components/MockUserSwitch";
import { AppShell } from "@/components/AppShell";
import { MOCK_COOKIE } from "@/lib/clientid";

export const metadata: Metadata = {
  title: SITE_META.title,
  description: SITE_META.description,
  keywords: SITE_META.keywords,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const admin = await isAdmin();
  const testAvailable = testModeAvailable();
  const testMode = await isTestMode();
  const contacts = await getClientContacts();

  // 正式环境只放行精简集;测试模式放行全部主题/布局/功能
  const allowedThemeIds = testMode ? THEME_IDS : LIVE_THEME_IDS;
  const allowedLayoutIds = testMode ? LAYOUT_IDS : LIVE_LAYOUT_IDS;
  const allowedFeatures = testMode ? [...FEATURE_IDS] : LIVE_FEATURES;

  const nav = admin ? [...NAV, { label: "admin", href: "/admin" }] : NAV;

  // 模拟访客身份:主题/昵称等偏好按身份分键(等价于一台独立设备);仅测试模式
  const mockCid = testMode ? ((await cookies()).get(MOCK_COOKIE)?.value ?? "") : "";

  const initScript = `${themeInitScript(allowedThemeIds, allowedLayoutIds, mockCid || undefined)};${NAV_INIT_SCRIPT}`;

  const adminTools = admin && testAvailable ? (
    <div className="zx-admintools">
      <EnvSwitch testMode={testMode} />
      {testMode && <MockUserSwitch current={mockCid} />}
    </div>
  ) : null;

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
          mockId={mockCid || undefined}
          extra={adminTools}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
