import { test, expect, type Page } from '@playwright/test'

/**
 * 不依赖私有 content.local.ts / content.json(CI 里没有,会兜底成单个「示例项目」),
 * 每个用例先经 API 种一批确定的项目,再验证拖拽。
 */
const SEED = [
  { id: 'e2e-a', name: 'E2E-A', kind: 'personal' },
  { id: 'e2e-b', name: 'E2E-B', kind: 'personal' },
  { id: 'e2e-c', name: 'E2E-C', kind: 'personal' },
  { id: 'e2e-w', name: 'E2E-W', kind: 'work' },
].map((p) => ({
  ...p,
  desc: '',
  tech: [],
  status: 'online',
  period: '',
  demoUrl: '',
  repoUrl: '',
  highlights: [],
  featured: false,
}))

/** 登录后台 */
async function login(page: Page) {
  await page.goto('/admin')
  await page.fill('#pw', 'test-admin-pass')
  await page.getByRole('button', { name: '进入' }).click()
  await page.getByRole('button', { name: '退出登录' }).waitFor()
}

/** 经浏览器同源 fetch 种数据(整表覆盖,无 rev) */
async function seed(page: Page) {
  const ok = await page.evaluate(async (projects) => {
    const r = await fetch('/api/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects }),
    })
    return r.ok
  }, SEED)
  expect(ok).toBeTruthy()
}

const personalNames = (page: Page) =>
  page.locator('#projects .zx-grid').first().locator('.zx-card h3').allInnerTexts()

test('访客:首页项目卡没有拖拽把手', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#projects')).toBeVisible()
  expect(await page.locator('.zx-card-grip').count()).toBe(0)
})

test('站长:首页项目卡有把手,拖拽后立即保存并改变顺序', async ({ page }) => {
  await login(page)
  await seed(page)
  await page.goto('/')

  await expect(page.locator('.zx-card-grip').first()).toBeVisible()
  const cards = page.locator('#projects .zx-grid').first().locator('.zx-card')
  const before = await personalNames(page)
  expect(before).toEqual(['E2E-A', 'E2E-B', 'E2E-C'])

  // 把第 1 张拖到第 3 张的右半边 → 落到第 3 张之后
  const grip0 = await cards.nth(0).locator('.zx-card-grip').boundingBox()
  const card2 = await cards.nth(2).boundingBox()
  expect(grip0 && card2).toBeTruthy()
  await page.mouse.move(grip0!.x + grip0!.width / 2, grip0!.y + grip0!.height / 2)
  await page.mouse.down()
  await page.mouse.move(card2!.x + card2!.width * 0.85, card2!.y + card2!.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('.zx-projects-admin-status')).toContainText('顺序已保存')
  const after = await personalNames(page)
  expect(after).toEqual(['E2E-B', 'E2E-C', 'E2E-A'])

  // 刷新后顺序仍在(已落库)
  await page.reload()
  expect(await personalNames(page)).toEqual(after)
})

test('站长:面板停在旧顺序时改内容保存,不会把首页拖出的新顺序冲回去', async ({ page }) => {
  await login(page)
  await seed(page)

  // 面板先加载 → 它的 baseline 是当前顺序 A
  await page.goto('/admin')
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const nameInput = page.getByLabel('名称').first()
  await expect(nameInput).toBeVisible()

  // 模拟「另一个标签页在首页拖拽」:直接调 API 换成顺序 B,让面板 baseline 过期
  const before = await page.evaluate(async () => {
    const r = await fetch('/api/admin/projects', { cache: 'no-store' })
    return (await r.json()) as { projects: { id: string; name: string }[]; rev?: string }
  })
  const moved = before.projects.map((p) => p.id)
  const [firstId] = moved.splice(0, 1) // 把第一项挪到最后
  moved.push(firstId)
  const byId = new Map(before.projects.map((p) => [p.id, p]))
  const payload = moved.map((id) => byId.get(id))
  const ok = await page.evaluate(
    async (data) => {
      const r = await fetch('/api/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return r.ok
    },
    { projects: payload, rev: before.rev },
  )
  expect(ok).toBeTruthy()

  // 面板里改第一张(e2e-a)的名字并保存(它手里的顺序仍是过期的 A)
  await nameInput.fill('E2E-A★')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.zx-msg.ok')).toContainText('项目已保存')

  // 首页个人组顺序应是 [e2e-b, e2e-c, e2e-a],而不是面板的旧顺序 [a, b, c]
  await page.goto('/')
  expect(await personalNames(page)).toEqual(['E2E-B', 'E2E-C', 'E2E-A★'])
})
