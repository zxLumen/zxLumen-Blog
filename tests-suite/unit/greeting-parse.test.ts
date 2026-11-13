// 问候语解析回归测试(纯函数,不需要 Next/DB)
import { describe, expect, it } from 'vitest'
import { isMangledGreeting, parseGreetingLines } from '../../apps/next-home/src/lib/chat/greeting-parse'

describe('parseGreetingLines', () => {
  it('保留行首日期,不把 11 当列表序号吃掉', () => {
    const line = '11月14日周六早上好,北京这会儿晴、4°C,别被晴天骗了,还是凉。'
    expect(parseGreetingLines(line)).toEqual([line])
  })

  it('保留年份开头的句子', () => {
    const line = '2026年11月14日周六,北京晴、4°C,想先聊项目还是经历?'
    expect(parseGreetingLines(line)).toEqual([line])
  })

  it('仍然去掉真正的列表序号', () => {
    const text = ['1. 周三下午好,北京晴、4°C。', '2、周三下午好,想聊项目吗?', '(3) 周三下午好,今天风大。', '- 周三下午好,随便问。', '• 周三下午好,先聊哪块?'].join('\n')
    expect(parseGreetingLines(text)).toEqual([
      '周三下午好,北京晴、4°C。',
      '周三下午好,想聊项目吗?',
      '周三下午好,今天风大。',
      '周三下午好,随便问。',
      '周三下午好,先聊哪块?',
    ])
  })

  it('温度统一成 °C', () => {
    expect(parseGreetingLines('北京今天 19℃,比昨天暖一点')).toEqual(['北京今天 19°C,比昨天暖一点'])
  })

  it('去重并遵守条数上限', () => {
    const text = ['周三下午好,北京晴、4°C。', '周三下午好,北京晴、4°C。', '周三下午好,风有点大。'].join('\n')
    expect(parseGreetingLines(text, 1)).toEqual(['周三下午好,北京晴、4°C。'])
  })
})

describe('isMangledGreeting', () => {
  it('识别被吃掉行首数字的残句', () => {
    expect(isMangledGreeting('月14日周六早上好,北京晴、4°C。')).toBe(true)
    expect(isMangledGreeting('年11月14日周六早上好。')).toBe(true)
  })

  it('正常日期句不算残句', () => {
    expect(isMangledGreeting('11月14日周六早上好,北京晴、4°C。')).toBe(false)
    expect(isMangledGreeting('周三下午好,北京晴、4°C。')).toBe(false)
  })
})
