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
} from "@zx/shared";
import { isAdmin } from "@/lib/auth";
import { getClientContacts } from "@/lib/settings";
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
  const contacts = await getClientContacts();

  const nav = admin ? [...NAV, { label: "admin", href: "/admin" }] : NAV;

  // 模拟访客身份:主题/昵称等偏好按身份分键(等价于一台独立设备);仅站长
  const mockCid = (await cookies()).get(MOCK_COOKIE)?.value ?? "";

  const initScript = `${themeInitScript(THEME_IDS, LAYOUT_IDS, mockCid || undefined)};${NAV_INIT_SCRIPT}`;

  const adminTools = admin ? <MockUserSwitch current={mockCid} /> : null;

  return (
    <html lang="zh-CN" data-theme="github-light" data-layout="sidebar" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body>
        <AppShell
          nav={nav}
          contacts={contacts}
          allowedThemeIds={THEME_IDS}
          allowedLayoutIds={LAYOUT_IDS}
          mockId={mockCid || undefined}
          extra={adminTools}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
