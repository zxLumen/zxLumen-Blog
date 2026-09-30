import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@zx/shared/styles.css";
import {
  NAV,
  NAV_INIT_SCRIPT,
  themeInitScript,
} from "@zx/shared";
import { getRuntimeContent } from "@zx/shared/server";
import { isAdmin } from "@/lib/auth";
import { getClientContacts } from "@/lib/settings";
import { getAppearance } from "@/lib/theme-config";
import { getVisibleApps } from "@/lib/app-config";
import { MockUserSwitch } from "@/components/MockUserSwitch";
import { AppShell } from "@/components/AppShell";
import { MOCK_COOKIE } from "@/lib/clientid";

export async function generateMetadata(): Promise<Metadata> {
  const { SITE_META } = await getRuntimeContent();
  return {
    title: SITE_META.title,
    description: SITE_META.description,
    keywords: SITE_META.keywords,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const admin = await isAdmin();
  const contacts = await getClientContacts();
  const { PROFILE } = await getRuntimeContent();

  const nav = admin ? [...NAV, { label: "admin", href: "/admin" }] : NAV;

  // 模拟访客身份:主题/昵称等偏好按身份分键(等价于一台独立设备);仅站长
  const mockCid = (await cookies()).get(MOCK_COOKIE)?.value ?? "";

  // 外观配置(admin 可配):放行集合 + 默认项
  const appearance = getAppearance();

  // 右侧应用栏(admin 可配):为空则不渲染、不占位(data-apps 不设)
  const apps = getVisibleApps();

  const initScript = `${themeInitScript(appearance.themes, appearance.layouts, appearance.defaultTheme, appearance.defaultLayout, mockCid || undefined)};${NAV_INIT_SCRIPT}`;

  const adminTools = admin ? <MockUserSwitch current={mockCid} /> : null;

  return (
    <html
      lang="zh-CN"
      data-theme={appearance.defaultTheme}
      data-layout={appearance.defaultLayout}
      data-apps={apps.length > 0 ? "1" : undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>
        <AppShell
          nav={nav}
          contacts={contacts}
          profile={PROFILE}
          apps={apps}
          allowedThemeIds={appearance.themes}
          allowedLayoutIds={appearance.layouts}
          defaultTheme={appearance.defaultTheme}
          defaultLayout={appearance.defaultLayout}
          mockId={mockCid || undefined}
          extra={adminTools}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
