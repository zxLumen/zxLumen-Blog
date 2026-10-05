import type { Metadata, Viewport } from "next";
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
import { getLuminariEmbedUrl } from "@/lib/luminari-embed";
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

/**
 * viewportFit: "cover" —— 配合样式里的 env(safe-area-inset-*),让页面延伸到
 * 刘海/圆角区域,再由 safe-area 内边距把内容推回可视区;缺了它 iOS 会把整页
 * 塞进"安全区",底部 fixed 悬浮件贴不上 home 指示条。
 * 另:不要加 user-scalable=no,会禁用无障碍缩放。
 * themeColor 取默认主题(terminal)的 --bg;14 个主题均为深色,状态栏不会出现割裂。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#040b07",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const admin = await isAdmin();
  const contacts = await getClientContacts();
  const { PROFILE } = await getRuntimeContent();

  const nav = admin
    ? [...NAV, { label: "admin", href: "/admin" }]
    : NAV.filter((n) => !n.adminOnly);

  // 模拟访客身份:主题/昵称等偏好按身份分键(等价于一台独立设备);仅站长
  const mockCid = (await cookies()).get(MOCK_COOKIE)?.value ?? "";

  // 外观配置(admin 可配):放行集合 + 默认项
  const appearance = getAppearance();

  // 右侧应用栏(admin 可配):为空则不渲染、不占位(data-apps 不设)
  const apps = getVisibleApps();

  // 四周生灵层:透明 iframe 嵌 luminari 的 embed.html,让 Top5 生灵出现在主站四周
  const luminariEmbed = getLuminariEmbedUrl();

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
          admin={admin && !mockCid}
          extra={adminTools}
        >
          {children}
        </AppShell>
        {luminariEmbed ? (
          <iframe
            src={luminariEmbed}
            title="luminari-field"
            aria-hidden="true"
            tabIndex={-1}
            style={{
              position: "fixed",
              inset: 0,
              width: "100%",
              height: "100%",
              border: 0,
              pointerEvents: "none",
              zIndex: 10,
              backgroundColor: "transparent",
              background: "transparent",
            }}
            allowtransparency="true"
            frameBorder="0"
          />
        ) : null}
      </body>
    </html>
  );
}
