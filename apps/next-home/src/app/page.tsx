import { cookies } from "next/headers";
import { HomePage } from "@zx/shared/ui";
import { getActiveDb } from "@/lib/env";
import { isAdmin } from "@/lib/auth";
import { getAdminNick } from "@/lib/settings";

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

  const db = await getActiveDb();
  const comments = admin ? db.listAllComments() : db.listPublicComments();
  const usage = db.listUsage(30);

  return (
    <HomePage
      comments={comments}
      usage={usage}
      isAdmin={admin}
      initialAuthor={initialAuthor}
    />
  );
}
