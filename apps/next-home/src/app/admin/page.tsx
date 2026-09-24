import type { Metadata } from "next";
import { AdminPanel } from "@zx/shared/ui";
import "@mantine/core/styles.layer.css";
import { getRuntimeContent } from "@zx/shared/server";

export const metadata: Metadata = {
  title: "admin · liuzixiang",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { PROJECTS } = await getRuntimeContent();
  return <AdminPanel projects={PROJECTS} />;
}
