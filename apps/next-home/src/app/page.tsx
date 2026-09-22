import { cookies } from "next/headers";
import type { UsageRow, UsageSel } from "@zx/shared";
import { USAGE_SEL_COOKIE, parseUsageSel } from "@zx/shared";
import { HomePage } from "@zx/shared/ui";
import { getActiveDb, isTestMode } from "@/lib/env";
import { isAdmin } from "@/lib/auth";
import { effectiveCid, isMockActive, MOCK_COOKIE } from "@/lib/clientid";
import { getAdminNick, getClientContacts } from "@/lib/settings";
import { fetchUsage } from "@/lib/deepseek";
import { getSourceAvailability } from "@/lib/usage-sources";

export const dynamic = "force-dynamic";

/** 昵称 cookie 键:模拟访客时按身份分键(与 shared nickKey 规则一致) */
const viewerNickKey = (mock: string) => `zx_nick${mock ? `.${mock}` : ""}`;

export default async function Home() {
  // 模拟访客身份(仅测试模式生效);决定昵称/主题按身份分键
  const viewerMock = (await isTestMode()) ? ((await cookies()).get(MOCK_COOKIE)?.value ?? "") : "";

  // 模拟访客时,首页按普通访客视角渲染(不显示站长特权)
  const admin = (await isAdmin()) && !(await isMockActive());
  let initialAuthor = "";
  if (admin) {
    initialAuthor = await getAdminNick();
  } else {
    const raw = (await cookies()).get(viewerNickKey(viewerMock))?.value ?? "";
    try {
      initialAuthor = raw ? decodeURIComponent(raw) : "";
    } catch {
      initialAuthor = raw;
    }
  }

  const viewerCid = await effectiveCid();
  const db = await getActiveDb();

  // 用量筛选存档(cookie 下发):SSR 首帧即按上次选择渲染,刷新无闪跳
  const initialSel: UsageSel = parseUsageSel((await cookies()).get(USAGE_SEL_COOKIE)?.value ?? "");

  // 各数据源可用性(已配置 + 近30天有数据):SSR 决定显示哪些源,避免隐藏源闪现
  const availableSources = await getSourceAvailability();

  // 首页统计聚合(访客/留言/事件);是否展示由客户端 useFeature('visitor-stats') 决定
  const stats = db.stats();

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
      initialSel={initialSel}
      availableSources={availableSources}
      stats={stats}
      isAdmin={admin}
      initialAuthor={initialAuthor}
      viewerMock={viewerMock || undefined}
      contacts={await getClientContacts()}
    />
  );
}
