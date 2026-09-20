import type { Metadata } from "next";
import "@zx/shared/styles.css";
import { NAV, NAV_INIT_SCRIPT, SITE_META, THEME_INIT_SCRIPT } from "@zx/shared";
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
  const nav = admin ? [...NAV, { label: "admin", href: "/admin" }] : NAV;

  return (
    <html lang="zh-CN" data-theme="github-light" data-layout="sidebar" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: `${THEME_INIT_SCRIPT};${NAV_INIT_SCRIPT}` }}
        />
      </head>
      <body>
        <AppShell
          nav={nav}
          contacts={contacts}
          extra={admin ? <EnvSwitch testMode={testMode} /> : null}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
