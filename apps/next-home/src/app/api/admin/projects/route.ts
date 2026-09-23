import { isAdmin } from "@/lib/auth";
import { readJson } from "@/lib/db";
import { getActiveDb } from "@/lib/env";
import {
  applyProjectOverrides,
  PROJECTS,
  type ProjectOverrideInput,
} from "@zx/shared";

export const dynamic = "force-dynamic";

// admin 项目覆盖接口:
//   GET    → { projects: 已合并覆盖的 PROJECTS, overrides: 覆盖记录[] }
//   POST   → { id, input: ProjectOverrideInput } 保存覆盖
//   DELETE → { id } 清除覆盖(恢复静态默认)
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = await getActiveDb();
  const overrides = db.getProjectOverrides();
  return Response.json({ projects: applyProjectOverrides(PROJECTS, overrides), overrides });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson<{ id: string; input: ProjectOverrideInput }>(req).catch(() => null);
  if (!body?.id || !body.input) return Response.json({ error: "缺少 id/input" }, { status: 400 });
  const db = await getActiveDb();
  db.setProjectOverride(body.id, body.input);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson<{ id: string }>(req).catch(() => null);
  if (!body?.id) return Response.json({ error: "缺少 id" }, { status: 400 });
  const db = await getActiveDb();
  db.clearProjectOverride(body.id);
  return Response.json({ ok: true });
}
