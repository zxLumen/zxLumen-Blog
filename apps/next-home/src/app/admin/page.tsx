import type { Metadata } from "next";
import { AdminPanel } from "@zx/shared/ui";
import "@mantine/core/styles.layer.css";
import { getAllProjectsForStats } from "@/lib/projects-config";
import { getVisibleVlogSeries } from "@/lib/vlog-config";

export const metadata: Metadata = {
  title: "admin · liuzixiang",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // 含已删除(垃圾箱)项目:埋点 target 为项目 id,解析名称时即便项目已删除也应显示名称
  const projects = await getAllProjectsForStats();
  // 视频ID → 系列/集标题(统计页「视频播放」表用)
  const vlogSeries = getVisibleVlogSeries();
  return <AdminPanel projects={projects} vlogSeries={vlogSeries} />;
}
