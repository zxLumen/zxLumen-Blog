'use client'

import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppOpenIn, StoredApp } from '../../schema.js'
import { MantineBridge } from './mantine-bridge.js'
import { adminFetch } from './admin-fetch.js'
import type { NotifyMsg } from './admin-types.js'
import { snapDropToGroup, useDragReorder } from '../useDragReorder.js'

/** 覆盖面门控:应用栏在 Tab 模式下仅对应 Tab 显 */
function gate(showTabs: boolean, tab: string): boolean {
  return showTabs && tab === 'apps'
}

/** id 需与服务端 app-config.ts 的白名单一致:字母数字与短横线,≤40 字符 */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i

const OPEN_OPTIONS = [
  { value: 'newtab', label: '新标签页' },
  { value: 'self', label: '当前页' },
]

function newId(): string {
  return `app-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

/**
 * 上传前在浏览器端等比压到长边 256 的 PNG:
 *  - 用 PNG 而非 JPEG —— 图标需要透明通道(应用图标常是圆角/异形),转 JPEG 会把透明区填成黑色
 *  - 不裁剪、不缩成正方形,保持原比例(栏内用 object-fit: contain 显示)
 *  - 几 MB 的手机原图 → 几十~几百 KB,服务端因此不必装 sharp 之类的原生依赖
 *  - imageOrientation: 'from-image' 让手机竖拍照片按 EXIF 摆正
 */
async function compressIcon(
  file: File,
  maxEdge = 256,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bmp.close()
    throw new Error('当前浏览器不支持图片处理,请换 Chrome/Safari')
  }
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('图片处理失败')
  return { blob, width: w, height: h }
}

export function AdminAppsPanel({
  active,
  showTabs,
  tab,
  onNotify,
}: {
  active: boolean
  showTabs: boolean
  tab: string
  onNotify?: (m: NotifyMsg) => void
}) {
  const [apps, setApps] = useState<StoredApp[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [loadKey, setLoadKey] = useState(0)
  /** 正在上传/恢复图标的行:app id */
  const [iconBusy, setIconBusy] = useState<Set<string>>(new Set())
  /**
   * 图标文件实际能否加载,按 id 记 'ok' / 'bad'。
   * 徽章不能看库里的 icon 字段 —— 库里有字段但文件没传到线上是很常见的,
   * 只有真去看这张图 load 没 load 出来才知道。
   */
  const [iconFile, setIconFile] = useState<Record<string, 'ok' | 'bad'>>({})
  const markIconFile = (id: string, s: 'ok' | 'bad') =>
    setIconFile((prev) => (prev[id] === s ? prev : { ...prev, [id]: s }))

  const gated = gate(showTabs, tab)
  useEffect(() => {
    if (gated && active) void load()
  }, [gated, active, loadKey])

  const notify = (kind: 'ok' | 'err', text: string) => onNotify?.({ kind, text })

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await adminFetch('/api/admin/apps', { cache: 'no-store' })
      const data = (await r.json()) as { apps?: StoredApp[] }
      setApps(data.apps ?? [])
      setDirty(false)
    } catch {
      notify('err', '应用列表加载失败')
    } finally {
      setBusy(false)
    }
  }, [notify])

  const mutate = (fn: (list: StoredApp[]) => StoredApp[]) => {
    setApps((list) => fn(list))
    setDirty(true)
  }

  const patch = (id: string, p: Partial<StoredApp>) =>
    mutate((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))

  const move = (id: string, dir: -1 | 1) =>
    mutate((list) => {
      const i = list.findIndex((it) => it.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const visible = apps.filter((a) => !a.deleted)
  const trashed = apps.filter((a) => a.deleted)
  const actionsDisabled = busy || saving

  /**
   * 拖拽排序复用访客应用栏那套指针实现(见 useDragReorder)。
   * 只重排可见项所占的槽位,垃圾箱里的条目原地不动 —— 免得拖一次把垃圾箱也搅乱。
   * admin 不传 groupOf(分组就是在这里改的,不能禁跨组),改由 adjustDrop 夹落点:
   * 拖到别的组中间时落到该组最近的一条边,保证**提交出去的顺序里同组必连续**。
   * 必要性:admin 拖出来的就是所有访客的默认顺序,一旦交错,每个访客都会看到多余
   * 分隔线,访客的 ↺ 也只重置访客顺序、回到这个交错默认,救不了。
   */
  const groupById = new Map(apps.map((a) => [a.id, a.group ?? '']))
  const { dragId, drop, registerItem, handleProps } = useDragReorder({
    ids: visible.map((a) => a.id),
    axis: 'y',
    adjustDrop: (ids, from, hit) => snapDropToGroup(ids, from, hit, (id) => groupById.get(id) ?? ''),
    onCommit: (nextIds) =>
      mutate((list) => {
        // nextIds 只是**可见项**的新顺序;按 id 取回整条,垃圾箱里的原地不动
        const byId = new Map(list.map((a) => [a.id, a]))
        let vi = 0
        return list.map((a) => (a.deleted ? a : (byId.get(nextIds[vi++]) ?? a)))
      }),
    getScrollBox: () => (typeof document === 'undefined' ? null : (document.scrollingElement as HTMLElement | null)),
    scrollWindow: true,
    disabled: actionsDisabled || visible.length < 2,
  })

  const addApp = () => {
    let id = newId()
    while (apps.some((a) => a.id === id)) id = newId()
    mutate((list) => [...list, { id, name: '新应用', url: '', openIn: 'newtab' }])
  }

  const trash = (id: string) => mutate((list) => list.map((it) => (it.id === id ? { ...it, deleted: true } : it)))
  const restore = (id: string) => mutate((list) => list.map((it) => (it.id === id ? { ...it, deleted: false } : it)))
  const purge = (id: string) => mutate((list) => list.filter((it) => it.id !== id))

  const save = async () => {
    setSaving(true)
    try {
      const r = await adminFetch('/api/admin/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apps }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; apps?: StoredApp[] }
      if (!r.ok) throw new Error(d.error || '保存失败')
      if (d.apps) setApps(d.apps)
      setDirty(false)
      notify('ok', '应用栏已保存(立即生效)')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const resetAll = async () => {
    if (!confirm('恢复出厂默认应用栏?当前所有应用配置将丢失。')) return
    setSaving(true)
    try {
      const r = await adminFetch('/api/admin/apps', { method: 'DELETE' })
      const d = (await r.json().catch(() => ({}))) as { apps?: StoredApp[] }
      if (!r.ok) throw new Error('恢复失败')
      if (d.apps) setApps(d.apps)
      setDirty(false)
      notify('ok', '已恢复出厂默认')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '恢复失败')
    } finally {
      setSaving(false)
    }
  }

  /**
   * 上传图标:浏览器端压到长边 256 的 PNG → POST multipart → 服务端写文件 + 立刻写库。
   * 不经过「整表保存」,所以不会把列表里其它未保存的编辑一起冲掉,也不用点保存。
   * 落库结果只就地打到本地 state 的那一条上(理由同上)。
   */
  const uploadIcon = async (id: string, file: File) => {
    if (!ID_RE.test(id)) {
      notify('err', '请先填写合法的 id(字母数字/短横线,≤40 字符)')
      return
    }
    // 服务端 patchAppIcon 只改已在库里的条目;新建的必须先保存
    if (!apps.some((a) => a.id === id)) {
      notify('err', '请先点「保存」让这条进入列表,再上传图标')
      return
    }
    setIconBusy((s) => new Set(s).add(id))
    try {
      const { blob, width, height } = await compressIcon(file)
      const fd = new FormData()
      fd.append('id', id)
      fd.append('file', new File([blob], `${id}.png`, { type: 'image/png' }))
      const r = await adminFetch('/api/admin/apps/icon', { method: 'POST', body: fd })
      const d = (await r.json().catch(() => ({}))) as { error?: string; icon?: string }
      if (!r.ok) throw new Error(d.error || '上传失败')
      const icon = d.icon
      if (!icon) throw new Error('上传失败:未返回图标路径')
      // 就地 patch 那一条 —— 不用服务端整表覆盖
      setApps((list) => list.map((it) => (it.id === id ? { ...it, icon } : it)))
      markIconFile(id, 'ok')
      notify('ok', `图标已更新(${width}×${height})并立即生效`)
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '上传失败')
    } finally {
      setIconBusy((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  /** 删除上传的图标文件,回落到名称首字 */
  const removeIcon = async (id: string) => {
    if (!apps.some((a) => a.id === id)) {
      notify('err', '该应用不在配置里')
      return
    }
    setIconBusy((s) => new Set(s).add(id))
    try {
      const r = await adminFetch('/api/admin/apps/icon', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; apps?: StoredApp[] }
      if (!r.ok) throw new Error(d.error || '删除失败')
      setApps((list) => list.map((it) => (it.id === id ? { ...it, icon: undefined } : it)))
      notify('ok', '图标已删除,将回落到名称首字')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '删除失败')
    } finally {
      setIconBusy((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  return (
    <MantineBridge>
      <Stack gap="md" mb="lg">
        <Group gap="xs" wrap="wrap" align="center">
          <Title order={3} style={{ margin: 0, fontSize: '1.1rem' }}>
            右侧应用栏
          </Title>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            固定在页面右边缘的竖排图标(macOS Dock 竖置版);窄屏自动转底部横条
          </Text>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            {visible.length} 个应用{trashed.length > 0 ? ` · 垃圾箱 ${trashed.length}` : ''}
          </Text>
          {dirty && (
            <Badge variant="dot" color="yellow" size="sm" style={{ fontFamily: 'var(--font-mono)' }}>
              未保存修改
            </Badge>
          )}
          <Group gap="xs" ml="auto">
            <Button size="compact-xs" variant="light" disabled={actionsDisabled} onClick={addApp}>
              + 新增应用
            </Button>
            <Button size="compact-xs" variant="default" disabled={actionsDisabled} onClick={() => void resetAll()}>
              恢复默认
            </Button>
            <Button size="xs" loading={saving} disabled={busy || !dirty} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </Group>
        </Group>

        <Text c="dimmed" fz="xs" ff="var(--font-mono)">
          提示:地址支持站内路径(`/resume.pdf`、`/#projects`)与外链;裸域名(如 `rag.zxlumen.cn`)保存时自动补
          https://。图标浏览器端压到长边 256 的 PNG(保留透明),上传即生效、不用点保存;不传图标则回落到名称首字。
          分组填相同的名字会在栏内自动插一条分隔线。窄屏(≤820px)自动变成底部横条。排序可按住左侧 ⠿ 拖动
          (鼠标、触屏都可以),也可用 ↑↓。这里排的是**默认**顺序;访客可以在自己屏幕上按住图标拖动微调,
          只会改他自己那份,不影响别人,拖乱了栏尾会出现 ↺ 恢复默认。
        </Text>

        {busy && <Text c="dimmed" fz="sm">加载中…</Text>}
        {!busy && visible.length === 0 && (
          <Text c="dimmed" fz="sm">暂无应用,点「+ 新增应用」添加。</Text>
        )}

        {!busy &&
          visible.map((a, vi) => {
            const busyRow = iconBusy.has(a.id)
            const letter = Array.from(a.name.trim())[0] ?? '?'
            const dragging = dragId === a.id
            const dropSide = !dragging && drop?.targetId === a.id ? (drop.before ? 'before' : 'after') : null
            return (
              <Paper
                key={a.id}
                withBorder
                radius={8}
                p="md"
                ref={registerItem(a.id)}
                data-dragging={dragging ? '' : undefined}
                data-drop={dropSide ?? undefined}
                style={{
                  opacity: dragging ? 0.4 : 1,
                  borderColor: dropSide ? 'var(--accent)' : undefined,
                  boxShadow: dropSide
                    ? `inset ${dropSide === 'before' ? '3px' : '-3px'} 0 0 var(--accent)`
                    : undefined,
                  transition: 'opacity .12s ease, box-shadow .12s ease',
                }}
              >
                <Stack gap="sm">
                  <Group gap="xs" wrap="wrap" align="center">
                    {/* 拖拽把手:整行都能拖的话,行内 TextInput 就没法选字/改字了,
                        所以只有这个把手能发起拖动;↑↓ 按钮仍是无鼠标的兜底。
                        指针实现(鼠标 + 触屏都能拖)见 useDragReorder */}
                    <Text
                      component="span"
                      {...handleProps(a.id)}
                      title="按住拖动可调整顺序(鼠标、触屏都可以)"
                      style={{
                        cursor: actionsDisabled || visible.length < 2 ? 'default' : 'grab',
                        userSelect: 'none',
                        color: 'var(--fg-dim)',
                        fontSize: '1rem',
                        lineHeight: 1,
                        padding: '0 2px',
                        touchAction: 'none',
                      }}
                    >
                      ⠿
                    </Text>
                    <TextInput
                      size="xs"
                      label="id"
                      description="文件名由它派生,只能用字母数字/短横线"
                      value={a.id}
                      disabled={actionsDisabled}
                      onChange={(e) => patch(a.id, { id: e.target.value })}
                      style={{ width: 190 }}
                    />
                    <Group gap="xs" ml="auto">
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={actionsDisabled || vi === 0}
                        onClick={() => move(a.id, -1)}
                        title="上移"
                      >
                        ↑
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={actionsDisabled || vi === visible.length - 1}
                        onClick={() => move(a.id, 1)}
                        title="下移"
                      >
                        ↓
                      </Button>
                      <Button size="compact-xs" variant="subtle" color="red" disabled={actionsDisabled} onClick={() => trash(a.id)}>
                        移入垃圾箱
                      </Button>
                    </Group>
                  </Group>

                  <Group gap="sm" wrap="wrap" align="flex-end">
                    <TextInput
                      size="xs"
                      label="名称"
                      value={a.name}
                      disabled={actionsDisabled}
                      onChange={(e) => patch(a.id, { name: e.target.value })}
                      style={{ flex: 1, minWidth: 140 }}
                    />
                    <TextInput
                      size="xs"
                      label="地址"
                      placeholder="https://… 或 /resume.pdf 或 /#projects"
                      value={a.url}
                      disabled={actionsDisabled}
                      onChange={(e) => patch(a.id, { url: e.target.value })}
                      style={{ flex: 2, minWidth: 200 }}
                    />
                    <Select
                      size="xs"
                      label="打开方式"
                      description="站内页面(/、/#vlog)始终走站内跳转;PDF / 图片等文件按此设置"
                      data={OPEN_OPTIONS}
                      value={a.openIn ?? 'newtab'}
                      allowDeselect={false}
                      disabled={actionsDisabled}
                      onChange={(val) => patch(a.id, { openIn: (val === 'self' ? 'self' : 'newtab') as AppOpenIn })}
                      style={{ width: 120, flex: 'none' }}
                    />
                    <TextInput
                      size="xs"
                      label="分组"
                      placeholder="选填"
                      value={a.group ?? ''}
                      disabled={actionsDisabled}
                      onChange={(e) => patch(a.id, { group: e.target.value })}
                      style={{ width: 120, flex: 'none' }}
                    />
                  </Group>

                  <Group gap="xs" wrap="wrap" align="center">
                    {/* 缩略图与栏内一致:等比 contain,所见即访客所见 */}
                    <Box
                      style={{
                        width: 44,
                        height: 44,
                        flex: 'none',
                        background: 'color-mix(in srgb, var(--bg-2) 78%, transparent)',
                        border: '1px solid var(--line)',
                        borderRadius: 12,
                        overflow: 'hidden',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {a.icon ? (
                        <img
                          src={a.icon}
                          alt=""
                          style={{ width: 26, height: 26, objectFit: 'contain', display: 'block' }}
                          onLoad={() => markIconFile(a.id, 'ok')}
                          onError={() => markIconFile(a.id, 'bad')}
                        />
                      ) : (
                        <Text fz={15} c="var(--accent)" ff="var(--font-mono)">
                          {letter}
                        </Text>
                      )}
                    </Box>
                    {a.icon ? (
                      iconFile[a.id] === 'bad' ? (
                        <Badge size="xs" color="red" variant="light" title="线上没找到这个文件,图标显示不出来">
                          图标文件缺失
                        </Badge>
                      ) : (
                        <Badge size="xs" color="teal" variant="light">
                          自定义图标
                        </Badge>
                      )
                    ) : (
                      <Badge size="xs" color="gray" variant="light">
                        名称首字兜底
                      </Badge>
                    )}
                    {a.icon && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={actionsDisabled || busyRow}
                        loading={busyRow}
                        onClick={() => void removeIcon(a.id)}
                        title="删除上传的图标文件,回落到名称首字"
                      >
                        删除图标
                      </Button>
                    )}
                    <Button
                      size="compact-xs"
                      variant="light"
                      disabled={actionsDisabled || busyRow}
                      component="label"
                      title="上传图标(浏览器端压到长边 256 的 PNG,保留透明,不等比裁剪)"
                    >
                      {busyRow ? '上传中…' : '上传/更换图标'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        disabled={actionsDisabled || busyRow}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          e.target.value = ''
                          if (f) void uploadIcon(a.id, f)
                        }}
                      />
                    </Button>
                    {a.icon && iconFile[a.id] === 'bad' && (
                      <Text fz="xs" c="yellow.7">
                        改了 id 会让已上传的图标文件变成孤儿(文件名由 id 派生);改完请重新上传。
                      </Text>
                    )}
                  </Group>
                </Stack>
              </Paper>
            )
          })}

        {trashed.length > 0 && (
          <Stack gap="xs">
            <Group gap="xs" align="center">
              <Button size="compact-xs" variant="subtle" onClick={() => setShowTrash((s) => !s)}>
                {showTrash ? '▾' : '▸'} 垃圾箱({trashed.length})
              </Button>
            </Group>
            {showTrash &&
              trashed.map((a) => (
                <Paper key={a.id} withBorder radius={8} p="sm" style={{ opacity: 0.75 }}>
                  <Group gap="xs" wrap="wrap" align="center">
                    <Text component="span" ff="var(--font-mono)" fz="xs" c="dimmed">
                      {a.id}
                    </Text>
                    <Text component="span" fz="xs" c="dimmed">
                      {a.name} — {a.url}
                    </Text>
                    <Group gap="xs" ml="auto">
                      <Button size="compact-xs" variant="light" disabled={actionsDisabled} onClick={() => restore(a.id)}>
                        恢复
                      </Button>
                      <Button size="compact-xs" variant="light" color="red" disabled={actionsDisabled} onClick={() => purge(a.id)}>
                        彻底删除
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              ))}
          </Stack>
        )}
      </Stack>
    </MantineBridge>
  )
}
