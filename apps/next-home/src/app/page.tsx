import { cookies } from "next/headers";
import type { UsageRow } from "@zx/shared";
import { HomePage } from "@zx/shared/ui";
import { getActiveDb } from "@/lib/env";
import { isAdmin } from "@/lib/auth";
import { effectiveCid, isMockActive } from "@/lib/clientid";
import { getAdminNick, getClientContacts } from "@/lib/settings";
import { fetchUsage } from "@/lib/deepseek";

export const dynamic = "force-dynamic";

export default async function Home() {
  // 模拟访客时,首页按普通访客视角渲染(不显示站长特权)
  const admin = (await isAdmin()) && !(await isMockActive());
  let initialAuthor = "";
  if (admin) {
    initialAuthor = getAdminNick();
  } else {
    const raw = (await cookies()).get("zx_nick")?.value ?? "";
    try {
      initialAuthor = raw ? decodeURIComponent(raw) : "";
    } catch {
      initialAuthor = raw;
    }
  }

  const viewerCid = await effectiveCid();
  const db = await getActiveDb();
  const commentsPage = db.listThreadPage({
    page: 1,
    pageSize: 5,
    includePrivate: admin,
    viewerCid,
  });

  // 优先 DeepSeek 平台真实用量;失败/未配置回退本地 usage 表(再空则前端用 mock)
  let usage: UsageRow[] | undefined;
  let usageWindow: { start?: string; end?: string } | undefined;
  try {
    const u = await fetchUsage("30d");
    usage = u.rows;
    usageWindow = { start: u.start, end: u.end };
  } catch {
    usage = undefined;
  }
  if (!usage || usage.length === 0) {
    usage = db.listUsage(30);
    usageWindow = undefined;
  }

  return (
    <HomePage
      commentsPage={commentsPage}
      usage={usage}
      usageWindow={usageWindow}
      isAdmin={admin}
      initialAuthor={initialAuthor}
      contacts={getClientContacts()}
    />
  );
}
