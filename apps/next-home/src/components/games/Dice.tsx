'use client'

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

export function PipDie({
  value,
  hidden = false,
  rolling = false,
  delay = 0,
  kind = 'none',
  small = false,
}: {
  value?: number
  hidden?: boolean
  rolling?: boolean
  delay?: number
  kind?: 'none' | 'mixed' | 'pure'
  small?: boolean
}) {
  const style = { '--die-delay': `${delay}ms` } as React.CSSProperties
  if (hidden || rolling) {
    return (
      <span className={`ld-die hidden${rolling ? ' shaking' : ''}${small ? ' small' : ''}`} style={style} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    )
  }
  return (
    <span
      className={`ld-die face-${value}${kind !== 'none' ? ` leopard ${kind}` : ''}${small ? ' small' : ''}`}
      style={style}
      role="img"
      aria-label={`${value} 点`}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <b key={index} className={PIPS[value ?? 1]?.includes(index) ? 'on' : ''} />
      ))}
    </span>
  )
}

export function DiceHand({
  dice,
  hidden,
  rolling,
  kind = 'none',
  count = 5,
  small = false,
}: {
  dice: number[]
  hidden?: boolean
  rolling?: boolean
  kind?: 'none' | 'mixed' | 'pure'
  count?: number
  small?: boolean
}) {
  return (
    <div className={`ld-dice-row${rolling ? ' rolling' : ''}${small ? ' small' : ''}`}>
      {Array.from({ length: count }, (_, index) => (
        <PipDie
          key={index}
          value={dice[index]}
          hidden={hidden}
          rolling={rolling}
          delay={index * 55}
          kind={kind}
          small={small}
        />
      ))}
    </div>
  )
}
