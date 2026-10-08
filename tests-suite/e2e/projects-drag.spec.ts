import { test, expect } from '@playwright/test'

/** 用后台把当前页设成管理员(复用 /admin 登录表单) */
async function login(page: import('@playwright/test').Page) {
  await page.goto('/admin')
  await page.fill('#pw', 'test-admin-pass')
  await page.getByRole('button', { name: '进入' }).click()
  await page.getByRole('button', { name: '退出登录' }).waitFor()
}

test('访客:首页项目卡没有拖拽把手', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#projects')).toBeVisible()
  expect(await page.locator('.zx-card-grip').count()).toBe(0)
})

test('站长:首页项目卡有把手,拖拽后立即保存并改变顺序', async ({ page }) => {
  await login(page)
  await page.goto('/')

  const grips = page.locator('.zx-card-grip')
  await expect(grips.first()).toBeVisible()

  const cards = page.locator('#projects .zx-grid').first().locator('.zx-card')
  const count = await cards.count()
  expect(count).toBeGreaterThanOrEqual(3)
  const before = await cards.locator('h3').allInnerTexts()

  // 把第 1 张拖到第 3 张的右半边 → 落到第 3 张之后
  const grip0 = await cards.nth(0).locator('.zx-card-grip').boundingBox()
  const card2 = await cards.nth(2).boundingBox()
  expect(grip0 && card2).toBeTruthy()
  await page.mouse.move(grip0!.x + grip0!.width / 2, grip0!.y + grip0!.height / 2)
  await page.mouse.down()
  await page.mouse.move(card2!.x + card2!.width * 0.85, card2!.y + card2!.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('.zx-projects-admin-status')).toContainText('顺序已保存')
  const after = await cards.locator('h3').allInnerTexts()
  expect(after).not.toEqual(before)
  expect(after.slice().sort()).toEqual(before.slice().sort())

  // 刷新后顺序仍在(已落库)
  await page.reload()
  const persisted = await page
    .locator('#projects .zx-grid')
    .first()
    .locator('.zx-card h3')
    .allInnerTexts()
  expect(persisted).toEqual(after)
})

test('站长:面板停在旧顺序时改内容保存,不会把首页拖出的新顺序冲回去', async ({ page }) => {
  await login(page)

  // 面板先加载 → 它的 baseline 是当前顺序 A
  await page.goto('/admin')
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const nameInput = page.getByLabel('名称').first()
  await expect(nameInput).toBeVisible()

  // 模拟「另一个标签页在首页拖拽」:直接调 API 换成顺序 B,让面板 baseline 过期
  const before = await page.evaluate(async () => {
    const r = await fetch('/api/admin/projects', { cache: 'no-store' })
    return (await r.json()) as {
      projects: { id: string; name: string; kind?: string; demoUrl?: string; deleted?: boolean }[]
      rev?: string
    }
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

  // 面板里改第一张的名字并保存(它手里的顺序仍是过期的 A)
  const panelFirstId = before.projects.find((p: { deleted?: boolean }) => !p.deleted).id
  const kindOf = (p: { kind?: string; demoUrl?: string }) =>
    p.kind ?? (p.demoUrl === '/' ? 'personal' : 'work')
  const orig = await nameInput.inputValue()
  await nameInput.fill(`${orig}★`)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.zx-msg.ok')).toContainText('项目已保存')

  const expected = payload
    .filter((p) => !p.deleted && kindOf(p) === 'personal')
    .map((p) => (p.id === panelFirstId ? `${p.name}★` : p.name))

  // 首页顺序应保持 B(不被面板的过期顺序冲回),改名生效
  await page.goto('/')
  const personalNames = await page
    .locator('#projects .zx-grid')
    .first()
    .locator('.zx-card h3')
    .allInnerTexts()
  expect(personalNames).toEqual(expected)
})
