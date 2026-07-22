import { useEffect, useRef, useState } from 'react'
import { Pal, pals, label } from './lib/breeding'
import { ELEMENT_COLORS, rarityTier } from './lib/ui'
import iconsJson from './data/icons.json'

const icons = iconsJson as Record<string, string>

export function PalIcon({ id, size = 32 }: { id: string; size?: number }) {
  const src = icons[id]
  if (!src) return null
  return <img className="palicon" src={src} width={size} height={size} alt="" />
}

export function palIconSrc(id: string): string | undefined {
  return icons[id]
}

export function ElementChips({ pal }: { pal: Pal }) {
  return (
    <span className="chips">
      {pal.elements.map(e => (
        <span key={e} className="chip" style={{ background: ELEMENT_COLORS[e] ?? '#888' }}>
          {e}
        </span>
      ))}
    </span>
  )
}

interface Props {
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
}

export function PalPicker({ value, onChange, placeholder = 'Search pal…' }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selected = value ? pals.find(p => p.id === value) : undefined
  const q = query.trim().toLowerCase()
  const matches = q
    ? pals.filter(p => p.name.toLowerCase().includes(q) || String(p.zukan).startsWith(q))
    : pals
  const shown = matches

  return (
    <div className="picker" ref={rootRef}>
      {selected && !open && <span className="picker-icon"><PalIcon id={selected.id} size={26} /></span>}
      <input
        className={selected && !open ? 'has-icon' : ''}
        value={open ? query : selected ? label(selected) : ''}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={e => setQuery(e.target.value)}
      />
      {selected && !open && (
        <button className="clear" onClick={() => onChange(null)} title="Clear">
          ×
        </button>
      )}
      {open && (
        <div className="dropdown">
          {shown.map(p => (
            <div
              key={p.id}
              className="option"
              onMouseDown={() => {
                onChange(p.id)
                setOpen(false)
              }}
            >
              <span className="optname">
                <PalIcon id={p.id} size={30} />
                <span className="optzukan">#{p.zukan}{p.suffix}</span>
                <span className={`optlabel ${rarityTier(p.rarity).cls}`}>{p.name}</span>
              </span>
              <ElementChips pal={p} />
            </div>
          ))}
          {shown.length === 0 && <div className="option muted">No matches</div>}
        </div>
      )}
    </div>
  )
}
