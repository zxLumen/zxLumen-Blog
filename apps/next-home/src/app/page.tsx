import { cookies } from "next/headers";
import type { UsageRow, UsageSel } from "@zx/shared";
import { USAGE_SEL_COOKIE, parseUsageSel } from "@zx/shared";
import { HomePage } from "@zx/shared/ui";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { effectiveCid, isMockActive, MOCK_COOKIE } from "@/lib/clientid";
import { getAdminNick, getClientContacts } from "@/lib/settings";
import { fetchSsrUsage } from "@/lib/usage/ssr-rows";
import { getSourceAvailability } from "@/lib/usage-sources";
import { getUsageSourceOrder, getUsageDefaultSource } from "@/lib/usage-source-order";
import { getRuntimeContent } from "@zx/shared/server";
import { getVisibleProjects, getStoredProjects, getProjectsRev } from "@/lib/projects-config";
import { getVisibleVlogSeries, pickRandomVlogStart } from "@/lib/vlog-config";
export const dynamic = "force-dynamic";

/** 昵称 cookie 键:模拟访客时按身份分键(与 shared nickKey 规则一致) */
const viewerNickKey = (mock: string) => `zx_nick${mock ? `.${mock}` : ""}`;

export default async function Home() {
  // 模拟访客身份(仅站长可设);决定昵称/主题按身份分键
  const viewerMock = (await cookies()).get(MOCK_COOKIE)?.value ?? "";

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
  const db = getDb();

  // 用量筛选存档(cookie 下发):SSR 首帧即按上次选择渲染,刷新无闪跳
  // 无存档时按 admin 配置的「默认数据源」初始化(缺省 DeepSeek)
  const defaultSource = getUsageDefaultSource();
  const initialSel: UsageSel = parseUsageSel(
    (await cookies()).get(USAGE_SEL_COOKIE)?.value ?? "",
    defaultSource,
  );
  // SSR 首帧预取的数据源 = 存档选中源(否则默认源):默认源非 DeepSeek 时首屏也有数据
  const ssrSrc = initialSel.dataSrc;

  // 各数据源可用性(已配置 + 近30天有数据):SSR 决定显示哪些源,避免隐藏源闪现
  const availableSources = {
    ...(await getSourceAvailability()),
    order: getUsageSourceOrder(),
    defaultSource,
  };

  // 首页统计聚合(访客/留言/事件)
  const stats = db.stats();

  const commentsPage = db.listThreadPage({
    page: 1,
    pageSize: 5,
    includePrivate: admin,
    viewerCid,
  });

  // 预取当前(存档/默认)数据源、访客所选区间的用量;失败回退本地 usage 表(再空则前端用 mock)
  let usage: UsageRow[] | undefined;
  let usageWindow: { start?: string; end?: string } | undefined;
  const ssrRange = initialSel.per[ssrSrc]?.range ?? "30d";
  const ssr = await fetchSsrUsage(ssrSrc, ssrRange);
  if (ssr) {
    usage = ssr.rows;
    usageWindow = { start: ssr.start, end: ssr.end };
  }
  // 本地 usage 表是 DeepSeek 口径,仅在默认源为 deepseek 时兜底
  if (ssrSrc === "deepseek" && (!usage || usage.length === 0)) {
    usage = db.listUsage(30);
    usageWindow = undefined;
  }

  // 项目(admin 后台增删/排序/软删;未配置时用运行时 content.json 的 PROJECTS)
  const projects = await getVisibleProjects();
  // 站长:额外下发「含垃圾箱的全量 + 乐观锁版本戳」,供首页直接拖拽排序后整表存回
  const adminStoredProjects = admin ? await getStoredProjects() : undefined;
  const projectsRev = admin ? getProjectsRev() : undefined;
  const content = await getRuntimeContent();

  // 抖音旅行视频系列(admin 后台配置;未配置则 Hero 右侧回退显示主题 ASCII)
  const vlogSeries = getVisibleVlogSeries();
  // 每次进入首页随机选一个视频起播(服务端随机 → SSR 与 hydration 一致)
  const vlogStart = pickRandomVlogStart(vlogSeries);

  return (
    <HomePage
      commentsPage={commentsPage}
      usage={usage}
      usageWindow={usageWindow}
      usageSource={ssrSrc}
      initialSel={initialSel}
      availableSources={availableSources}
      stats={stats}
      projects={projects}
      isAdmin={admin}
      adminStoredProjects={adminStoredProjects}
      projectsRev={projectsRev}
      initialAuthor={initialAuthor}
      viewerMock={viewerMock || undefined}
      contacts={await getClientContacts()}
      profile={content.PROFILE}
      links={content.LINKS}
      tech={content.TECH}
      timeline={content.TIMELINE}
      vlogSeries={vlogSeries}
      vlogStart={vlogStart}
    />
  );
}
