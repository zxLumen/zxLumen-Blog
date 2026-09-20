import type { Metadata } from "next";
import { AdminPanel } from "@zx/shared/ui";

export const metadata: Metadata = {
  title: "admin · liuzixiang",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminPanel />;
}
