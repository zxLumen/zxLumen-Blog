import { cookies } from "next/headers";
import type { UsageRow } from "@zx/shared";
import { HomePage } from "@zx/shared/ui";
import { getActiveDb } from "@/lib/env";
import { isAdmin } from "@/lib/auth";
import { getAdminNick, getClientContacts } from "@/lib/settings";
import { fetchUsage } from "@/lib/deepseek";

export const dynamic = "force-dynamic";

export default async function Home() {
  const admin = await isAdmin();
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

  const viewerCid = (await cookies()).get("zx_cid")?.value ?? "";
  const db = await getActiveDb();
  const commentsPage = db.listThreadPage({
    page: 1,
    pageSize: 5,
    includePrivate: admin,
    viewerCid,
  });

  // 优先 DeepSeek 平台真实用量;失败/未配置回退本地 usage 表(再空则前端用 mock)
  let usage: UsageRow[] | undefined;
  try {
    usage = (await fetchUsage("30d")).rows;
  } catch {
    usage = undefined;
  }
  if (!usage || usage.length === 0) usage = db.listUsage(30);

  return (
    <HomePage
      commentsPage={commentsPage}
      usage={usage}
      isAdmin={admin}
      initialAuthor={initialAuthor}
      contacts={getClientContacts()}
    />
  );
}
