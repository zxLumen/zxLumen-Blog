'use client'

import {
  ActionIcon,
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
import { useCallback, useEffect, useState } from 'react'
import type { StoredVlogSeries, StoredVlogVideo } from '../../schema.js'
import { MantineBridge } from './mantine-bridge.js'
import { adminFetch } from './admin-fetch.js'
import type { NotifyMsg } from './admin-types.js'

/** 覆盖面门控:抖音视频管理在 Tab 模式下仅对应 Tab 显 */
function gate(showTabs: boolean, tab: string): boolean {
  return showTabs && tab === 'vlog'
}

function newId(): string {
  return `vlog-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

const ORIENTATION_OPTIONS = [
  { value: '', label: '自动' },
  { value: 'portrait', label: '竖屏' },
  { value: 'landscape', label: '横屏' },
]

/** 与前端 HeroVlog.isLandscape 同口径:显式标记优先,否则按宽高比 */
function isLandscape(v: StoredVlogVideo): boolean {
  return (
    v.orientation === 'landscape' ||
    (v.orientation !== 'portrait' && Number(v.w) > 0 && Number(v.h) > 0 && Number(v.w) > Number(v.h))
  )
}

/** 缩略图用的封面 URL:有 cover 用它,横屏否则按 vid 推兜底图;竖屏无封面返回 null */
function coverUrlOf(v: StoredVlogVideo): string | null {
  if (v.cover) return v.cover
  return isLandscape(v) && /^\d{6,}$/.test(v.vid) ? `/vlog/${v.vid}.jpg` : null
}

/**
 * 上传前在浏览器端等比压到长边 1280 的 JPEG(q0.85):
 *  - 不裁剪、不垫黑边,保持原比例(方向不一致由前端 object-fit: contain 补黑边)
 *  - 几 MB 的手机原图 → 约 100~300KB,服务端因此不必装 sharp 之类的原生依赖
 *  - imageOrientation: 'from-image' 让手机竖拍照片按 EXIF 摆正
 */
async function compressCover(
  file: File,
  maxEdge = 1280,
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
  // 透明图转 JPEG 需要垫底色,否则透明区会变黑
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
  if (!blob) throw new Error('图片处理失败')
  return { blob, width: w, height: h }
}

export function AdminVlogPanel({
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
  const [series, setSeries] = useState<StoredVlogSeries[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [fetching, setFetching] = useState<Set<string>>(new Set())
  /** 正在上传/恢复封面的行:`${sid}:${idx}` */
  const [coverBusy, setCoverBusy] = useState<Set<string>>(new Set())
  /** 上传后服务端给的「方向不一致会补黑边」提示,按 vid 记 */
  const [coverHints, setCoverHints] = useState<Record<string, string>>({})
  /** 封面文件实际能不能加载:按 vid 记 'ok' / 'bad'。
   *  徽章不能看库里的 cover 字段 —— 线上库通常没有该字段(前端按 vid 推导),
   *  只有真去看这张图 load 没 load 出来,才能知道兜底封面到底在不在。 */
  const [coverFile, setCoverFile] = useState<Record<string, 'ok' | 'bad'>>({})
  const markCoverFile = (vid: string, s: 'ok' | 'bad') =>
    setCoverFile((prev) => (prev[vid] === s ? prev : { ...prev, [vid]: s }))

  const gated = gate(showTabs, tab)
  useEffect(() => {
    if (gated && active) void load()
  }, [gated, active])

  const notify = (kind: 'ok' | 'err', text: string) => onNotify?.({ kind, text })

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await adminFetch('/api/admin/vlog', { cache: 'no-store' })
      const data = (await r.json()) as { series?: StoredVlogSeries[] }
      setSeries(data.series ?? [])
      setDirty(false)
    } catch {
      notify('err', '视频列表加载失败')
    } finally {
      setBusy(false)
    }
  }, [notify])

  const mutate = (fn: (list: StoredVlogSeries[]) => StoredVlogSeries[]) => {
    setSeries((list) => fn(list))
    setDirty(true)
  }

  const patchSeries = (id: string, p: Partial<StoredVlogSeries>) =>
    mutate((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))

  const moveSeries = (id: string, dir: -1 | 1) =>
    mutate((list) => {
      const i = list.findIndex((it) => it.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const addSeries = () =>
    mutate((list) => [...list, { id: newId(), name: '新系列', videos: [] }])

  const trashSeries = (id: string) =>
    mutate((list) => list.map((it) => (it.id === id ? { ...it, deleted: true } : it)))
  const restoreSeries = (id: string) =>
    mutate((list) => list.map((it) => (it.id === id ? { ...it, deleted: false } : it)))
  const purgeSeries = (id: string) => mutate((list) => list.filter((it) => it.id !== id))

  const addVideo = (sid: string) =>
    mutate((list) =>
      list.map((it) => (it.id === sid ? { ...it, videos: [...it.videos, { vid: '', title: '' }] } : it)),
    )

  const patchVideo = (
    sid: string,
    idx: number,
    p: Partial<{
      vid: string
      title: string
      orientation: 'portrait' | 'landscape' | undefined
      w: number
      h: number
    }>,
  ) =>
    mutate((list) =>
      list.map((it) =>
        it.id === sid ? { ...it, videos: it.videos.map((v, i) => (i === idx ? { ...v, ...p } : v)) } : it,
      ),
    )

  const moveVideo = (sid: string, idx: number, dir: -1 | 1) =>
    mutate((list) =>
      list.map((it) => {
        if (it.id !== sid) return it
        const j = idx + dir
        if (j < 0 || j >= it.videos.length) return it
        const videos = [...it.videos]
        ;[videos[idx], videos[j]] = [videos[j], videos[idx]]
        return { ...it, videos }
      }),
    )

  const delVideo = (sid: string, idx: number) =>
    mutate((list) =>
      list.map((it) => (it.id === sid ? { ...it, videos: it.videos.filter((_, i) => i !== idx) } : it)),
    )

  /** 单条按视频ID取标题 + 宽高(抖音作品描述已去 #话题/@提及;宽高用于自动判断横竖屏) */
  const refreshTitle = async (sid: string, idx: number, vid: string) => {
    if (!vid) {
      notify('err', '请先填写视频ID')
      return
    }
    const key = `${sid}:${idx}`
    setFetching((s) => new Set(s).add(key))
    try {
      const r = await adminFetch('/api/admin/vlog/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vid }),
      })
      const d = (await r.json().catch(() => ({}))) as {
        title?: string | null
        w?: number
        h?: number
        error?: string
      }
      if (!r.ok) throw new Error(d.error || '获取失败')
      const patch: Partial<{ title: string; w: number; h: number }> = {}
      if (d.title) patch.title = d.title
      if (d.w) patch.w = d.w
      if (d.h) patch.h = d.h
      if (Object.keys(patch).length === 0) {
        notify('err', '未取到信息(非公开 / 无效视频),可手动填写')
        return
      }
      patchVideo(sid, idx, patch)
      notify('ok', d.title ? `已获取标题:${d.title}` : '已获取视频尺寸')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '获取失败')
    } finally {
      setFetching((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }
  }

  /**
   * 上传封面:浏览器端压到长边 1280 的 JPEG → POST multipart → 服务端写文件 + 立刻写库。
   * 不经过「整表保存」,所以不会把列表里其它未保存的编辑一起冲掉,也不用点保存。
   * 落库结果只就地打到本地 state 的那一条上(不用服务端整表覆盖,理由同上)。
   */
  const uploadCover = async (sid: string, idx: number, vid: string, file: File) => {
    if (!/^\d{6,}$/.test(vid)) {
      notify('err', '请先填写视频ID,并点「保存」让它进入列表,再上传封面')
      return
    }
    const key = `${sid}:${idx}`
    setCoverBusy((s) => new Set(s).add(key))
    try {
      const { blob, width, height } = await compressCover(file)
      const fd = new FormData()
      fd.append('vid', vid)
      fd.append('file', new File([blob], `${vid}.jpg`, { type: 'image/jpeg' }))
      const r = await adminFetch('/api/admin/vlog/cover', { method: 'POST', body: fd })
      const d = (await r.json().catch(() => ({}))) as {
        error?: string
        cover?: string
        at?: string
        hint?: string | null
      }
      if (!r.ok) throw new Error(d.error || '上传失败')
      const cover = d.cover ?? `/vlog/${vid}.user.jpg`
      const at = d.at ?? new Date().toISOString()
      setSeries((list) =>
        list.map((it) =>
          it.id === sid
            ? {
                ...it,
                videos: it.videos.map((v, i) =>
                  i === idx ? { ...v, cover, coverSrc: 'user', coverAt: at } : v,
                ),
              }
            : it,
        ),
      )
      setCoverHints((h) => {
        const next = { ...h }
        delete next[vid]
        return next
      })
      notify('ok', `封面已更新(${width}×${height})并立即生效`)
      if (d.hint) setCoverHints((h) => ({ ...h, [vid]: d.hint as string }))
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '上传失败')
    } finally {
      setCoverBusy((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }
  }

  /** 恢复兜底:删掉上传图,回落到抖音首帧兜底图(竖屏没有兜底图 → 回到播放器自带封面) */
  const restoreCover = async (vid: string) => {
    if (!/^\d{6,}$/.test(vid)) {
      notify('err', '请先填写视频ID')
      return
    }
    setCoverBusy((s) => new Set(s).add(`restore:${vid}`))
    try {
      const r = await adminFetch('/api/admin/vlog/cover', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vid }),
      })
      const d = (await r.json().catch(() => ({}))) as {
        error?: string
        fallback?: string | null
        at?: string
      }
      if (!r.ok) throw new Error(d.error || '恢复失败')
      setSeries((list) =>
        list.map((it) => ({
          ...it,
          videos: it.videos.map((v) =>
            v.vid === vid
              ? {
                  ...v,
                  ...(d.fallback
                    ? { cover: d.fallback, coverSrc: 'douyin' as const, coverAt: d.at }
                    : { cover: undefined, coverSrc: undefined, coverAt: undefined }),
                }
              : v,
          ),
        })),
      )
      notify('ok', d.fallback ? '已恢复到抖音首帧兜底图' : '已删除上传封面,回到播放器自带封面')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '恢复失败')
    } finally {
      setCoverBusy((s) => {
        const n = new Set(s)
        n.delete(`restore:${vid}`)
        return n
      })
    }
  }

  const save = async () => {    setSaving(true)
    try {
      const r = await adminFetch('/api/admin/vlog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series }),
      })
      const d = (await r.json().catch(() => ({}))) as {
        error?: string
        series?: StoredVlogSeries[]
        filled?: number
      }
      if (!r.ok) throw new Error(d.error || '保存失败')
      if (d.series) setSeries(d.series)
      setDirty(false)
      notify('ok', d.filled ? `视频已保存(自动补全 ${d.filled} 个标题)` : '视频已保存(立即生效)')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const resetAll = async () => {
    if (!confirm('清空全部视频配置?当前所有系列/集数将丢失。')) return
    setSaving(true)
    try {
      const r = await adminFetch('/api/admin/vlog', { method: 'DELETE' })
      const d = (await r.json().catch(() => ({}))) as { series?: StoredVlogSeries[] }
      if (!r.ok) throw new Error('清空失败')
      if (d.series) setSeries(d.series)
      setDirty(false)
      notify('ok', '已清空视频配置')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '清空失败')
    } finally {
      setSaving(false)
    }
  }

  const visible = series.filter((s) => !s.deleted)
  const trashed = series.filter((s) => s.deleted)
  const totalVideos = visible.reduce((n, s) => n + s.videos.length, 0)
  const actionsDisabled = busy || saving

  const videoEditor = (s: StoredVlogSeries) => (
    <div>
      <Text component="label" fz="xs" c="dimmed" style={{ display: 'block', marginBottom: 6 }}>
        视频(按顺序播放;抖音数字视频ID + 选填标题 + 画面方向;标题/宽高留空保存时自动获取)
      </Text>
      <Stack gap={6}>
        {s.videos.map((v, i) => {
          const rowKey = `${s.id}:${i}`
          const uploading = coverBusy.has(rowKey)
          const restoring = coverBusy.has(`restore:${v.vid}`)
          const url = coverUrlOf(v)
          const thumb = url ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(v.coverAt ?? '0')}` : null
          return (
            <Paper key={rowKey} withBorder p={6} radius="sm">
              <Group gap="xs" wrap="nowrap" align="center">
                <Text component="span" ff="var(--font-mono)" fz="xs" c="dimmed" w={28} ta="right">
                  {i + 1}
                </Text>
                <TextInput
                  size="xs"
                  placeholder="抖音视频ID,或粘贴 douyin.com/video/… 链接"
                  value={v.vid}
                  disabled={actionsDisabled}
                  onChange={(e) => patchVideo(s.id, i, { vid: e.target.value })}
                  style={{ flex: 2 }}
                />
                <TextInput
                  size="xs"
                  placeholder="标题(选填)"
                  value={v.title ?? ''}
                  disabled={actionsDisabled}
                  onChange={(e) => patchVideo(s.id, i, { title: e.target.value })}
                  style={{ flex: 1 }}
                />
                <Select
                  size="xs"
                  data={ORIENTATION_OPTIONS}
                  value={v.orientation ?? ''}
                  allowDeselect={false}
                  disabled={actionsDisabled}
                  onChange={(val) =>
                    patchVideo(s.id, i, {
                      orientation:
                        val === 'landscape' ? 'landscape' : val === 'portrait' ? 'portrait' : undefined,
                    })
                  }
                  style={{ width: 72, flex: 'none' }}
                  aria-label="画面方向"
                  title={v.w && v.h ? `${v.w}×${v.h}` : '自动:按视频宽高判断'}
                />
                <Text component="span" ff="var(--font-mono)" fz="xs" c="dimmed" w={64} title="视频原始宽高">
                  {v.w && v.h ? `${v.w}×${v.h}` : '—'}
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={actionsDisabled || !v.vid || fetching.has(rowKey)}
                  loading={fetching.has(rowKey)}
                  onClick={() => void refreshTitle(s.id, i, v.vid)}
                  title="按视频ID获取标题与宽高"
                >
                  ↻
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={actionsDisabled}
                  onClick={() => moveVideo(s.id, i, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={actionsDisabled}
                  onClick={() => moveVideo(s.id, i, 1)}
                >
                  ↓
                </Button>
                <ActionIcon
                  size="input-xs"
                  variant="subtle"
                  color="red"
                  disabled={actionsDisabled}
                  onClick={() => delVideo(s.id, i)}
                  aria-label="删除该视频"
                >
                  ×
                </ActionIcon>
              </Group>
              <Group gap="xs" mt={6} wrap="wrap" align="center">
                {/* 缩略图按卡片同样的规则显示:等比缩放 + 补黑边,所见即访客所见 */}
                <Box
                  style={{
                    width: 72,
                    height: 54,
                    flex: 'none',
                    background: '#000',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    overflow: 'hidden',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                      onLoad={() => markCoverFile(v.vid, 'ok')}
                      onError={() => markCoverFile(v.vid, 'bad')}
                    />
                  ) : (
                    <Text fz={10} c="dimmed">
                      无封面
                    </Text>
                  )}
                </Box>
                {v.coverSrc === 'user' ? (
                  <Badge size="xs" color="teal" variant="light">
                    你的封面
                  </Badge>
                ) : isLandscape(v) ? (
                  coverFile[v.vid] === 'bad' ? (
                    <Badge
                      size="xs"
                      color="red"
                      variant="light"
                      title="本地跑 npm run cover:push 抓抖音首帧并推到线上(或 npm run cover:vlog 只生成本地)"
                    >
                      缺兜底封面
                    </Badge>
                  ) : (
                    <Badge
                      size="xs"
                      color="gray"
                      variant="light"
                      title="抖音首帧兜底图;要换成自己的封面请点「上传封面」"
                    >
                      兜底首帧
                    </Badge>
                  )
                ) : (
                  <Badge size="xs" color="gray" variant="light">
                    播放器自带封面
                  </Badge>
                )}
                {v.coverSrc === 'user' && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={actionsDisabled || restoring}
                    loading={restoring}
                    onClick={() => void restoreCover(v.vid)}
                    title="删除上传的封面,回落到抖音首帧兜底图"
                  >
                    恢复兜底
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="light"
                  disabled={actionsDisabled || uploading || restoring}
                  component="label"
                  title="上传封面(浏览器端压到长边 1280 的 JPEG,不等比裁剪)"
                >
                  {uploading ? '上传中…' : '上传/更换封面'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={actionsDisabled || uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void uploadCover(s.id, i, v.vid, f)
                    }}
                  />
                </Button>
                {coverHints[v.vid] && (
                  <Text fz="xs" c="yellow.7">
                    {coverHints[v.vid]}
                  </Text>
                )}
              </Group>
            </Paper>
          )
        })}
      </Stack>
      <Button size="compact-xs" variant="subtle" mt={6} disabled={actionsDisabled} onClick={() => addVideo(s.id)}>
        + 添加视频
      </Button>
    </div>
  )

  return (
    <MantineBridge>
      <Stack gap="md" mb="lg">
        <Group gap="xs" wrap="wrap" align="center">
          <Title order={3} style={{ margin: 0, fontSize: '1.1rem' }}>
            抖音视频
          </Title>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            主页 Hero 右侧播放器;可新增系列 / 增删排序视频,保存后立即生效
          </Text>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            {visible.length} 个系列 · {totalVideos} 个视频{trashed.length > 0 ? ` · 垃圾箱 ${trashed.length}` : ''}
          </Text>
          {dirty && (
            <Badge variant="dot" color="yellow" size="sm" style={{ fontFamily: 'var(--font-mono)' }}>
              未保存修改
            </Badge>
          )}
          <Group gap="xs" ml="auto">
            <Button size="compact-xs" variant="light" disabled={actionsDisabled} onClick={addSeries}>
              + 新增系列
            </Button>
            <Button size="compact-xs" variant="default" disabled={actionsDisabled} onClick={() => void resetAll()}>
              清空
            </Button>
            <Button size="xs" loading={saving} disabled={busy || !dirty} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </Group>
        </Group>

        <Text c="dimmed" fz="xs" ff="var(--font-mono)">
          提示:电脑端打开抖音视频详情,地址栏 douyin.com/video/<strong>数字</strong> 里那串数字即视频ID(可直接粘贴整条链接,保存时自动提取)。标题留空时,保存会按视频ID自动获取抖音<strong>作品描述</strong>(已去 #话题/@提及);也可点「↻」单条刷新或手动填写。
        </Text>

        {busy && <Text c="dimmed" fz="sm">加载中…</Text>}
        {!busy && visible.length === 0 && (
          <Text c="dimmed" fz="sm">暂无系列,点「+ 新增系列」添加(如「东北大环线」「京云大环线」)。</Text>
        )}

        {!busy &&
          visible.map((s) => (
            <Paper key={s.id} withBorder radius={8} p="md">
              <Stack gap="sm">
                <Group gap="xs" wrap="wrap" align="center">
                  <Text component="span" ff="var(--font-mono)" lh={1} fz="xs" c="dimmed">
                    {s.id}
                  </Text>
                  <Badge variant="light" size="sm" style={{ fontFamily: 'var(--font-mono)' }}>
                    {s.videos.length} 集
                  </Badge>
                  <Group gap={4} ml="auto">
                    <Button size="compact-xs" variant="subtle" disabled={actionsDisabled} onClick={() => moveSeries(s.id, -1)}>
                      ↑
                    </Button>
                    <Button size="compact-xs" variant="subtle" disabled={actionsDisabled} onClick={() => moveSeries(s.id, 1)}>
                      ↓
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="red" disabled={actionsDisabled} onClick={() => trashSeries(s.id)}>
                      移入垃圾箱
                    </Button>
                  </Group>
                </Group>

                <TextInput
                  label="系列名称"
                  size="xs"
                  value={s.name}
                  onChange={(e) => patchSeries(s.id, { name: e.target.value })}
                />

                {videoEditor(s)}
              </Stack>
            </Paper>
          ))}

        {trashed.length > 0 && (
          <Stack gap="xs">
            <Group gap="xs" align="center">
              <Button size="compact-xs" variant="subtle" onClick={() => setShowTrash((s) => !s)}>
                {showTrash ? '▾' : '▸'} 垃圾箱({trashed.length})
              </Button>
            </Group>
            {showTrash &&
              trashed.map((s) => (
                <Paper key={s.id} withBorder radius={8} p="sm" style={{ opacity: 0.75 }}>
                  <Group gap="xs" wrap="wrap" align="center">
                    <Text component="span" ff="var(--font-mono)" fz="xs" c="dimmed">
                      {s.id}
                    </Text>
                    <Text component="span" fz="xs" c="dimmed">
                      {s.name}({s.videos.length} 集)
                    </Text>
                    <Group gap="xs" ml="auto">
                      <Button size="compact-xs" variant="light" disabled={actionsDisabled} onClick={() => restoreSeries(s.id)}>
                        恢复
                      </Button>
                      <Button size="compact-xs" variant="light" color="red" disabled={actionsDisabled} onClick={() => purgeSeries(s.id)}>
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
