import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'

/**
 * lab 整组路由的**站长门**。
 *
 * 为什么加这个:`/lab/*` 的正常用法就是「一次跑一批」(`/lab/score` 一次 30 只),
 * 而这些请求会真的烧上游 token。在此之前 lab 完全没有门,于是有两种坏结果:
 *   1. 站长本人被「每人每天 5 只」拦住 —— 数据库里能看到某个 cookie 记了 6 只,
 *      而 `settle()` 只对非 admin 记次数,说明当时**没登录**就来了页面;
 *   2. 反过来,任何知道网址的人都能无限跑批次,靠的只有那个每 IP 120/分钟的
 *      限流器 —— 而它是**按请求频率**挡的,12 路并发起跑时一秒就能打满。
 *
 * 有了这层门,「demo 不做限流」才成立:进来的必然是站长本人,`isAdmin()` 为真,
 * 服务端的频率/次数闸门本来就对他全部放行(见 `generate/route.ts` 的 `exempt`)。
 * 真正该保留的是**日预算** —— 那是钱,不是频率。
 */
export default async function LabLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect('/admin')
  return <>{children}</>
}
