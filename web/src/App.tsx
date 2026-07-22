import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  Pal,
  pals,
  palById,
  label,
  breedOutcomes,
  parentsFor,
  findPath,
  findBloodline,
  combos,
  PathStep,
} from './lib/breeding'
import { passives, inheritChance, exactChance } from './lib/passives'
import { rarityTier, genderText, ELEMENT_COLORS, WEAK_TO, WORK_ICONS, WORK_COLORS } from './lib/ui'
import workIconsJson from './data/workicons.json'

const workIconSrc = workIconsJson as Record<string, string>
import { spawnsFor, worldMap, treeMap, SPAWN_GRID, gameCoords } from './lib/spawns'
import { PalPicker, ElementChips, PalIcon, palIconSrc } from './PalPicker'
import bossesJson from './data/bosses.json'

interface WorldBoss {
  id: string
  pal: string
  lv: number
  m: 'main' | 'tree'
  u: number
  v: number
}
const worldBosses = bossesJson as WorldBoss[]

function mixColors(a: string, b: string): string {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round((v + pb[i]) / 2).toString(16).padStart(2, '0')).join('')
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface SpawnCluster {
  cx: number
  cy: number
  maxd: number
  size: number
}

// group cells into clusters: cells within LINK grid units join the same one
function clusterCells(cells: [number, number][], link: number): SpawnCluster[] {
  const unvisited = new Set(cells.map((_, i) => i))
  const out: SpawnCluster[] = []
  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value!
    unvisited.delete(seed)
    const members = [seed]
    const queue = [seed]
    while (queue.length > 0) {
      const cur = cells[queue.pop()!]
      for (const i of [...unvisited]) {
        const p = cells[i]
        if (Math.abs(p[0] - cur[0]) <= link && Math.abs(p[1] - cur[1]) <= link) {
          unvisited.delete(i)
          members.push(i)
          queue.push(i)
        }
      }
    }
    let sx = 0, sy = 0
    for (const i of members) { sx += cells[i][0]; sy += cells[i][1] }
    const cx = sx / members.length
    const cy = sy / members.length
    let maxd = 0
    for (const i of members) {
      const d = Math.hypot(cells[i][0] - cx, cells[i][1] - cy)
      if (d > maxd) maxd = d
    }
    out.push({ cx, cy, maxd, size: members.length })
  }
  return out
}

const CLUSTER_LINK = 14 // grid units

function SpawnMapView({ palId, onRequestClose }: { palId: string | null; onRequestClose?: () => void }) {
  const info = palId ? spawnsFor(palId) : null
  const hasMain = !!info && (info.main.day.length > 0 || info.main.night.length > 0)
  const hasTree = !!info && (info.tree.day.length > 0 || info.tree.night.length > 0)
  const [which, setWhich] = useState<'main' | 'tree'>('main')
  // when a newly selected pal has no spawns on the current map but does on the
  // other, jump there once - the user can still switch freely afterwards
  useEffect(() => {
    if (!info) return
    if (which === 'main' && !hasMain && hasTree) setWhich('tree')
    else if (which === 'tree' && !hasTree && hasMain) setWhich('main')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palId])
  const [showDay, setShowDay] = useState(true)
  const [showNight, setShowNight] = useState(true)
  const [dayColor, setDayColor] = useState('#ffc83c')
  const [nightColor, setNightColor] = useState('#6eaaff')
  const [full, setFull] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<[number, number]>([0, 0])
  const [hover, setHover] = useState<[number, number] | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<null | { x: number; y: number; px: number; py: number }>(null)
  const viewRef = useRef({ zoom: 1, pan: [0, 0] as [number, number] })
  viewRef.current = { zoom, pan }

  const pts = info ? (which === 'main' ? info.main : info.tree) : { day: [], night: [] }
  const mapSrc = which === 'main' ? worldMap : treeMap

  // clusters of the currently visible cells - drive both the attention rings
  // and the "best spot" readout (center of the densest cluster, so it never
  // averages between islands into open water)
  const clusters = useMemo(() => {
    const seen = new Set<number>()
    const shown: [number, number][] = []
    const add = (set: [number, number][]) => {
      for (const [x, y] of set) {
        const k = y * SPAWN_GRID + x
        if (!seen.has(k)) { seen.add(k); shown.push([x, y]) }
      }
    }
    if (showDay) add(pts.day)
    if (showNight) add(pts.night)
    return clusterCells(shown, CLUSTER_LINK)
  }, [pts, showDay, showNight])

  const best = clusters.length > 0 ? clusters.reduce((a, b) => (b.size > a.size ? b : a)) : null
  const bestCoords = best
    ? gameCoords(best.cx / (SPAWN_GRID - 1), best.cy / (SPAWN_GRID - 1), which)
    : null

  const clampPan = (p: [number, number], z: number): [number, number] => {
    const lim = (z - 1) / 2 / z
    return [Math.max(-lim, Math.min(lim, p[0])), Math.max(-lim, Math.min(lim, p[1]))]
  }

  const canvasRef = (node: HTMLCanvasElement | null) => {
    if (!node) return
    const ctx = node.getContext('2d')!
    const W = node.width
    ctx.clearRect(0, 0, W, W)
    const cell = W / SPAWN_GRID
    const dot = Math.max(4, cell * 1.9)
    const dayKeys = new Set(pts.day.map(([x, y]) => y * SPAWN_GRID + x))
    const nightKeys = new Set(pts.night.map(([x, y]) => y * SPAWN_GRID + x))
    const halo = Math.max(1.5, cell * 0.3)
    const draw = (keys: Iterable<number>, color: string) => {
      // dark halo first so the dots stand out on any terrain color
      ctx.fillStyle = 'rgba(10, 14, 20, 0.55)'
      for (const k of keys) ctx.fillRect((k % SPAWN_GRID) * cell - halo, Math.floor(k / SPAWN_GRID) * cell - halo, dot + halo * 2, dot + halo * 2)
      ctx.fillStyle = color
      for (const k of keys) ctx.fillRect((k % SPAWN_GRID) * cell, Math.floor(k / SPAWN_GRID) * cell, dot, dot)
    }
    const both = mixColors(dayColor, nightColor)
    if (showDay && showNight) {
      draw([...dayKeys].filter(k => !nightKeys.has(k)), hexToRgba(dayColor, 0.85))
      draw([...nightKeys].filter(k => !dayKeys.has(k)), hexToRgba(nightColor, 0.85))
      draw([...dayKeys].filter(k => nightKeys.has(k)), hexToRgba(both, 0.9))
    } else if (showDay) {
      draw(dayKeys, hexToRgba(dayColor, 0.85))
    } else if (showNight) {
      draw(nightKeys, hexToRgba(nightColor, 0.85))
    }

    // attention rings around each spawn cluster - small habitats are easy to
    // miss on the full map, so circle every cluster of visible cells
    if (clusters.length > 0) {
      const rings = clusters.map(c => ({
        cx: c.cx * cell + cell / 2,
        cy: c.cy * cell + cell / 2,
        r: Math.max(W * 0.03, (c.maxd + 6) * cell),
      }))
      ctx.save()
      for (const ring of rings) {
        ctx.beginPath()
        ctx.arc(ring.cx, ring.cy, ring.r, 0, Math.PI * 2)
        ctx.lineWidth = W * 0.003
        ctx.strokeStyle = 'rgba(10, 14, 20, 0.6)'
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(ring.cx, ring.cy, ring.r, 0, Math.PI * 2)
        ctx.lineWidth = W * 0.0016
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
        ctx.shadowBlur = W * 0.006
        ctx.stroke()
        ctx.shadowBlur = 0
      }
      ctx.restore()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (full) {
          e.stopPropagation()
          setFull(false)
        } else if (onRequestClose) {
          e.stopPropagation()
          onRequestClose()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onRequestClose, full])

  // The map itself is the largest centered square inside the wrap (in
  // fullscreen the wrap is wider than the letterboxed map).
  const baseRect = () => {
    const r = wrapRef.current!.getBoundingClientRect()
    const size = Math.min(r.width, r.height)
    return {
      left: r.left + (r.width - size) / 2,
      top: r.top + (r.height - size) / 2,
      size,
    }
  }

  // pointer position (0..1 in displayed square) -> map fraction, accounting for zoom/pan
  const toMapFrac = (clientX: number, clientY: number): [number, number] => {
    const rect = baseRect()
    const { zoom: z, pan: p } = viewRef.current
    const sx = (clientX - rect.left) / rect.size
    const sy = (clientY - rect.top) / rect.size
    return [(sx - 0.5) / z + 0.5 - p[0], (sy - 0.5) / z + 0.5 - p[1]]
  }

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [mu, mv] = toMapFrac(e.clientX, e.clientY)
      const { zoom: z } = viewRef.current
      const nz = Math.max(1, Math.min(10, z * (e.deltaY < 0 ? 1.25 : 0.8)))
      const rect = baseRect()
      const sx = (e.clientX - rect.left) / rect.size
      const sy = (e.clientY - rect.top) / rect.size
      // keep the point under the cursor fixed while zooming
      const lim = (nz - 1) / 2 / nz
      const npan: [number, number] = [
        Math.max(-lim, Math.min(lim, (sx - 0.5) / nz + 0.5 - mu)),
        Math.max(-lim, Math.min(lim, (sy - 0.5) / nz + 0.5 - mv)),
      ]
      setZoom(nz)
      setPan(npan)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
    // re-attach when fullscreen remounts the map container
  }, [full])

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const { pan: p } = viewRef.current
    dragRef.current = { x: e.clientX, y: e.clientY, px: p[0], py: p[1] }
    const move = (ev: MouseEvent) => {
      if (!dragRef.current || !wrapRef.current) return
      const rect = baseRect()
      const { zoom: z } = viewRef.current
      const dx = (ev.clientX - dragRef.current.x) / rect.size / z
      const dy = (ev.clientY - dragRef.current.y) / rect.size / z
      setPan(clampPan([dragRef.current.px + dx, dragRef.current.py + dy], z))
    }
    const up = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const [u, v] = toMapFrac(e.clientX, e.clientY)
    setHover(u >= 0 && u <= 1 && v >= 0 && v <= 1 ? gameCoords(u, v, which) : null)
  }

  const reset = () => { setZoom(1); setPan([0, 0]) }

  const view = (
    <>
      <div className="maptoolbar">
        <span className="mapnavbtns">
          <button className={`modal-btn ${which === 'main' ? 'primary' : ''}`} onClick={() => { setWhich('main'); reset() }}>World</button>
          <button className={`modal-btn ${which === 'tree' ? 'primary' : ''}`} onClick={() => { setWhich('tree'); reset() }}>World Tree</button>
          {info && which === 'main' && !hasMain && hasTree && <span className="note">no world spawns - see World Tree</span>}
          {info && which === 'tree' && !hasTree && hasMain && <span className="note">no World Tree spawns - see World</span>}
        </span>
        <span className="mapnavbtns">
          {zoom > 1 && <button className="modal-btn" onClick={reset}>reset zoom</button>}
          <button className="modal-btn" onClick={() => setFull(!full)}>{full ? '🗗 Exit fullscreen' : '🗖 Fullscreen'}</button>
        </span>
      </div>
      <div
        className="mapwrap"
        ref={wrapRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <div
          className="mapinner"
          style={{ transform: `scale(${zoom}) translate(${pan[0] * 100}%, ${pan[1] * 100}%)` }}
        >
          <img src={mapSrc} alt="Map" draggable={false} />
          <canvas
            ref={canvasRef}
            width={2048}
            height={2048}
            key={`${palId}-${which}-${showDay}-${showNight}-${dayColor}-${nightColor}`}
          />
        </div>
        {hover && <div className="maphover">({hover[0]}, {hover[1]})</div>}
      </div>
      <div className="maplegend">
        <button className={`legend day ${showDay ? 'on' : ''}`} style={{ borderColor: showDay ? dayColor : undefined }} onClick={() => setShowDay(!showDay)}>
          ☀ Day {pts.day.length ? '' : '(none)'}
        </button>
        <input type="color" className="colorpick" value={dayColor} onChange={e => setDayColor(e.target.value)} title="Day highlight color" />
        <button className={`legend night ${showNight ? 'on' : ''}`} style={{ borderColor: showNight ? nightColor : undefined }} onClick={() => setShowNight(!showNight)}>
          ☾ Night {pts.night.length ? '' : '(none)'}
        </button>
        <input type="color" className="colorpick" value={nightColor} onChange={e => setNightColor(e.target.value)} title="Night highlight color" />
        {showDay && showNight && (
          <span className="note">
            <span className="swatch both" style={{ background: mixColors(dayColor, nightColor) }} /> = day &amp; night
          </span>
        )}
        {bestCoords && (
          <span
            className="mapcentroid"
            title={`Center of the pal's biggest spawn cluster${clusters.length > 1 ? ` (of ${clusters.length} areas)` : ''} - approximate in-game coordinates`}
          >
            best spot: ({bestCoords[0]}, {bestCoords[1]})
          </span>
        )}
      </div>
    </>
  )

  if (full) {
    // portal to <body>: ancestor backdrop-filter would otherwise trap the
    // fixed-position fullscreen layer inside the popup
    return createPortal(
      <div className="modal-backdrop mapdrop full">
        <div className="mapmodal full">{view}</div>
      </div>,
      document.body,
    )
  }
  return <div className="mapview">{view}</div>
}

function SpawnMapOverlay({ palId, onClose }: { palId: string; onClose: () => void }) {
  const pal = palById.get(palId)!
  return (
    <div className="modal-backdrop mapdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mapmodal">
        <div className="modal-nav">
          <span className="maptitle">
            <PalIcon id={palId} size={30} />
            {pal.name} - spawn locations
          </span>
          <button className="modal-btn close" onClick={onClose}>× Close</button>
        </div>
        <SpawnMapView palId={palId} onRequestClose={onClose} />
      </div>
    </div>
  )
}

function SortBar<T extends string>({ options, value, onChange }: {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="sortbar">
      <span className="muted small">Sort:</span>
      {options.map(([id, name]) => (
        <button key={id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
    </div>
  )
}

function ElementBar({ value, onChange }: { value: string | null; onChange: (e: string | null) => void }) {
  return (
    <div className="sortbar">
      <span className="muted small">Element:</span>
      {Object.keys(ELEMENT_COLORS).map(e => (
        <button
          key={e}
          className={`elem ${value === e ? 'active' : ''}`}
          style={{ '--elc': ELEMENT_COLORS[e] } as CSSProperties}
          onClick={() => onChange(value === e ? null : e)}
        >
          {e}
        </button>
      ))}
    </div>
  )
}

type PalSort = 'zukan' | 'name' | 'rarity' | 'element' | 'power'
const PAL_SORTS = [
  ['zukan', 'Paldeck #'],
  ['name', 'Name'],
  ['rarity', 'Rarity'],
  ['element', 'Element'],
  ['power', 'Breeding power'],
] as const

function sortPals(list: Pal[], sort: PalSort): Pal[] {
  const l = [...list]
  const zukan = (a: Pal, b: Pal) => a.zukan - b.zukan || a.suffix.localeCompare(b.suffix)
  switch (sort) {
    case 'name': l.sort((a, b) => a.name.localeCompare(b.name)); break
    case 'rarity': l.sort((a, b) => b.rarity - a.rarity || zukan(a, b)); break
    case 'element': l.sort((a, b) => (a.elements[0] ?? '').localeCompare(b.elements[0] ?? '') || zukan(a, b)); break
    case 'power': l.sort((a, b) => a.rank - b.rank || zukan(a, b)); break
    default: l.sort(zukan)
  }
  return l
}

interface DetailApi {
  openPal: (id: string) => void
  gotoReverse: (id: string) => void
  gotoPath: (id: string) => void
}
const DetailCtx = createContext<DetailApi>({ openPal: () => {}, gotoReverse: () => {}, gotoPath: () => {} })

/** A pal name + icon that opens the detail view when clicked. */
function PalLink({ id, size = 30, strong, showZukan }: { id: string; size?: number; strong?: boolean; showZukan?: boolean }) {
  const { openPal } = useContext(DetailCtx)
  const p = palById.get(id)
  if (!p) return null
  return (
    <button className={`palref linked ${strong ? 'strong' : ''}`} onClick={() => openPal(id)} title={`${label(p)} - details`}>
      <PalIcon id={id} size={size} />
      {showZukan ? label(p) : p.name}
    </button>
  )
}

function PalCard({ pal, note, big, clickable = true, onIconClick }: {
  pal: Pal
  note?: string
  big?: boolean
  clickable?: boolean
  onIconClick?: () => void
}) {
  const { openPal } = useContext(DetailCtx)
  const tier = rarityTier(pal.rarity)
  return (
    <div
      className={`palcard ${tier.cls} ${big ? 'big' : ''} ${clickable ? 'clickable' : ''}`}
      onClick={clickable ? () => openPal(pal.id) : undefined}
      title={clickable ? `${pal.name} - details` : undefined}
    >
      <div
        className={`palcard-icon ${onIconClick ? 'zoomable' : ''}`}
        onClick={onIconClick ? e => { e.stopPropagation(); onIconClick() } : undefined}
        title={onIconClick ? 'View image' : undefined}
      >
        <PalIcon id={pal.id} size={big ? 88 : 64} />
      </div>
      <div className="palcard-body">
        <div className="palzukan">#{pal.zukan}{pal.suffix}</div>
        <div className="palname">{pal.name}</div>
        <ElementChips pal={pal} />
        <div className="palmeta">
          <span className={`raritybadge ${tier.cls}`}>{tier.name}</span>
          <span className="meta">{genderText(pal)}</span>
        </div>
        {note && <div className="note">{note}</div>}
      </div>
    </div>
  )
}

function PalDetailModal({ id, hasBack, onBack, onClose }: { id: string; hasBack: boolean; onBack: () => void; onClose: () => void }) {
  const { gotoReverse, gotoPath } = useContext(DetailCtx)
  const pal = palById.get(id)!
  const pairCount = useMemo(() => parentsFor(id).length, [id])
  const asChild = combos.filter(c => c.child === id)
  const asParent = combos.filter(c => (c.a === id || c.b === id) && c.child !== id)
  const selfChild = breedOutcomes(id, id)[0]?.child
  const spawnInfo = spawnsFor(id)
  const [showMap, setShowMap] = useState(false)
  const [showImg, setShowImg] = useState(false)
  useEffect(() => { setShowMap(false); setShowImg(false) }, [id])

  useEffect(() => {
    if (showMap) return // map overlay owns Escape while open
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (hasBack ? onBack : onClose)()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hasBack, onBack, onClose, showMap])

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-nav">
          {hasBack && <button className="modal-btn" onClick={onBack}>← Back</button>}
          <button className="modal-btn close" onClick={onClose}>× Close</button>
        </div>
        <PalCard pal={pal} big clickable={false} onIconClick={() => setShowImg(true)} />
        <div className="modal-cols">
          <div>
            <h3>Stats</h3>
            <div className="deckstats">
              <div><span className="statlabel">HP</span><b>{pal.stats.hp}</b></div>
              <div><span className="statlabel">Attack</span><b>{pal.stats.atk}</b></div>
              <div><span className="statlabel">Defense</span><b>{pal.stats.def}</b></div>
              <div><span className="statlabel">Work speed</span><b>{pal.stats.workSpeed}</b></div>
              <div><span className="statlabel">Stamina</span><b>{pal.stats.stamina}</b></div>
              <div><span className="statlabel">Food</span><b>{pal.stats.food}</b></div>
              <div><span className="statlabel">Run / ride speed</span><b>{pal.stats.run} / {pal.stats.ride}</b></div>
              {pal.nocturnal && <div><span className="statlabel">Active</span><b>🌙 nocturnal</b></div>}
            </div>
            <h3>Breeding</h3>
            <div className="deckstats">
              <div><span className="statlabel">Breeding power</span><b>{pal.rank}</b></div>
              <div><span className="statlabel">Parent pairs</span><b>{pairCount}</b></div>
              <div>
                <span className="statlabel">Locked breeding</span>
                <b>{pal.ignoreCombi ? 'yes - unique combos only' : 'no'}</b>
              </div>
              {selfChild && selfChild.id !== pal.id && (
                <div><span className="statlabel">Bred with itself</span><PalLink id={selfChild.id} size={24} /></div>
              )}
            </div>
          </div>
          <div>
            <h3>Weak to</h3>
            <div className="chips">
              {[...new Set(pal.elements.map(e => WEAK_TO[e]).filter(Boolean))].map(e => (
                <span key={e} className="chip" style={{ background: ELEMENT_COLORS[e] ?? '#888' }}>{e}</span>
              ))}
            </div>
            <h3>Work suitability</h3>
            <div className="worklist">
              {Object.keys(WORK_ICONS).map(w => {
                const lv = pal.work[w] ?? 0
                return (
                  <div key={w} className={`workrow ${lv === 0 ? 'none' : ''}`}>
                    <span className="workicon" style={{ background: WORK_COLORS[w] ?? '#666' }}>
                      {workIconSrc[w]
                        ? <img src={workIconSrc[w]} width={16} height={16} alt="" />
                        : WORK_ICONS[w]}
                    </span>
                    <span className="statlabel">{w}</span>
                    <b>{lv > 0 ? `Lv ${lv}` : '-'}</b>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {asChild.length > 0 && (
          <>
            <h3>Unique combos that produce it</h3>
            <div className="modal-combos">
              {asChild.map((c, i) => (
                <div key={i} className="pairrow">
                  <PalLink id={c.a} size={26} />
                  <span className="x">×</span>
                  <PalLink id={c.b} size={26} />
                  <span className="x">=</span>
                  <PalLink id={id} size={26} strong />
                  {(c.aG || c.bG) && (
                    <span className="note">({c.aG === 'Male' ? '♂' : '♀'} × {c.bG === 'Male' ? '♂' : '♀'})</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {asParent.length > 0 && (
          <>
            <h3>Unique combos it's a parent in</h3>
            <div className="modal-combos">
              {asParent.slice(0, 8).map((c, i) => (
                <div key={i} className="pairrow">
                  <PalLink id={id} size={26} />
                  <span className="x">×</span>
                  <PalLink id={c.a === id ? c.b : c.a} size={26} />
                  <span className="x">=</span>
                  <PalLink id={c.child} size={26} strong />
                </div>
              ))}
              {asParent.length > 8 && <p className="muted small">+{asParent.length - 8} more</p>}
            </div>
          </>
        )}
        <div className="modal-actions">
          {spawnInfo ? (
            <button className="modal-btn primary" onClick={() => setShowMap(true)}>📍 Spawn map</button>
          ) : (
            <span className="note">No wild spawns - breeding or special sources only.</span>
          )}
          <button className="modal-btn primary" onClick={() => gotoReverse(id)}>🎯 Find all parents</button>
          <button className="modal-btn primary" onClick={() => gotoPath(id)}>🗺️ Plan path from it</button>
        </div>
      </div>
      {showMap && <SpawnMapOverlay palId={id} onClose={() => setShowMap(false)} />}
      {showImg && (
        <div className="modal-backdrop imgdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowImg(false) }}>
          <div className="imgbox">
            <PalIcon id={id} size={360} />
            <div className="imgcaption">{pal.name}</div>
            <button className="modal-btn close" onClick={() => setShowImg(false)}>× Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptySlot({ text }: { text: string }) {
  return <div className="palcard empty"><span className="muted">{text}</span></div>
}

function BreedTab() {
  const [a, setA] = useState<string | null>(null)
  const [b, setB] = useState<string | null>(null)
  const outcomes = a && b ? breedOutcomes(a, b) : []
  const palA = a ? palById.get(a) : undefined
  const palB = b ? palById.get(b) : undefined
  return (
    <section>
      <p className="lede">Pick two parents - the egg is deterministic, given by each pal's hidden breeding power.</p>
      <div className="pickers">
        <PalPicker value={a} onChange={setA} placeholder="Parent 1" />
        <button
          className="swap"
          title="Swap parents"
          onClick={() => { setA(b); setB(a) }}
          disabled={!a && !b}
        >
          ⇄
        </button>
        <PalPicker value={b} onChange={setB} placeholder="Parent 2" />
      </div>
      <div className="equation">
        {palA ? <PalCard pal={palA} /> : <EmptySlot text="Parent 1" />}
        <span className="op">×</span>
        {palB ? <PalCard pal={palB} /> : <EmptySlot text="Parent 2" />}
        <span className="op">=</span>
        {outcomes.length > 0 ? (
          <div className="outcomes">
            {outcomes.map((o, i) => (
              <PalCard key={i} pal={o.child} big note={o.genderNote && `only when ${o.genderNote}`} />
            ))}
          </div>
        ) : (
          <EmptySlot text="Child" />
        )}
      </div>
    </section>
  )
}

const PAIR_SORTS = [
  ['zukan', 'Paldeck #'],
  ['name', 'Name'],
  ['common', 'Common first'],
  ['rare', 'Rarest first'],
  ['element', 'Element'],
] as const
type PairSort = (typeof PAIR_SORTS)[number][0]

function ReverseTab({ target, setTarget }: { target: string | null; setTarget: (id: string | null) => void }) {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<PairSort>('zukan')
  const [elem, setElem] = useState<string | null>(null)
  const pairs = useMemo(() => (target ? parentsFor(target) : []), [target])
  const f = filter.trim().toLowerCase()
  let shown = f
    ? pairs.filter(p => p.a.name.toLowerCase().includes(f) || p.b.name.toLowerCase().includes(f))
    : pairs
  if (elem) shown = shown.filter(p => p.a.elements.includes(elem) || p.b.elements.includes(elem))
  {
    const zukan = (x: Pal, y: Pal) => x.zukan - y.zukan || x.suffix.localeCompare(y.suffix)
    const pairRarity = (p: { a: Pal; b: Pal }) => Math.max(p.a.rarity, p.b.rarity)
    shown = [...shown]
    switch (sort) {
      case 'name': shown.sort((p, q) => p.a.name.localeCompare(q.a.name) || p.b.name.localeCompare(q.b.name)); break
      case 'common': shown.sort((p, q) => pairRarity(p) - pairRarity(q) || zukan(p.a, q.a)); break
      case 'rare': shown.sort((p, q) => pairRarity(q) - pairRarity(p) || zukan(p.a, q.a)); break
      case 'element': shown.sort((p, q) => (p.a.elements[0] ?? '').localeCompare(q.a.elements[0] ?? '') || zukan(p.a, q.a)); break
      default: shown.sort((p, q) => zukan(p.a, q.a) || zukan(p.b, q.b))
    }
  }
  const targetPal = target ? palById.get(target) : undefined
  return (
    <section>
      <p className="lede">Pick the pal you want - every parent pair that hatches it.</p>
      <div className="pickers">
        <PalPicker value={target} onChange={setTarget} placeholder="Target child" />
        {pairs.length > 0 && (
          <input
            className="filter slim"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by parent…"
          />
        )}
      </div>
      {targetPal && pairs.length > 0 && (
        <>
          <SortBar options={PAIR_SORTS} value={sort} onChange={setSort} />
          <ElementBar value={elem} onChange={setElem} />
        </>
      )}
      {targetPal && (
        <>
          <div className="reverse-head">
            <PalCard pal={targetPal} big />
            <div className="paircount">
              <b>{shown.length}</b>
              <span>parent pair{shown.length === 1 ? '' : 's'}{(f || elem) && ` (of ${pairs.length})`}</span>
            </div>
          </div>
          <div className="pairlist">
            {shown.map((p, i) => (
              <div key={i} className="pairrow">
                <PalLink id={p.a.id} showZukan />
                <span className="x">×</span>
                <PalLink id={p.b.id} showZukan />
                <span className="x">=</span>
                <PalLink id={target!} strong />
                {p.genderNote && <span className="note">({p.genderNote})</span>}
              </div>
            ))}
            {shown.length === 0 && <p className="muted">No pairs{f ? ' match the filter' : ' - only obtainable in the wild or from its locked combo'}.</p>}
          </div>
        </>
      )}
    </section>
  )
}

function PathTab({ start, setStart }: { start: string | null; setStart: (id: string | null) => void }) {
  const [mode, setMode] = useState<'bloodline' | 'owned'>('bloodline')
  const [owned, setOwned] = useState<string[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [carried, setCarried] = useState<string[]>([])
  const [pfilter, setPfilter] = useState('')
  const result = useMemo(
    () => (mode === 'owned' && target && owned.length > 0 ? findPath(owned, target) : undefined),
    [mode, owned, target],
  )
  const bloodline = useMemo(
    () => (mode === 'bloodline' && start && target ? findBloodline(start, target) : undefined),
    [mode, start, target],
  )
  const add = (id: string | null) => {
    if (id && !owned.includes(id)) setOwned([...owned, id])
    setPick(null)
  }
  const toggleCarried = (id: string) =>
    setCarried(carried.includes(id) ? carried.filter(c => c !== id) : carried.length < 4 ? [...carried, id] : carried)

  const n = carried.length
  // each step: carrier parent holds the n wanted passives, partner holds none →
  // pool = n, need all n
  const stepP = n > 0 ? inheritChance(n, n) : 1
  const steps = mode === 'owned' ? result?.steps ?? [] : []
  const chainLen = mode === 'bloodline' ? bloodline?.length ?? 0 : steps.length
  const chainP = n > 0 ? Math.pow(stepP, chainLen) : 1
  const eggsPerStep = stepP > 0 ? 1 / stepP : Infinity
  const totalEggs = chainLen * eggsPerStep
  const [psort, setPsort] = useState<'tier' | 'name'>('tier')
  const f = pfilter.trim().toLowerCase()
  let plist = f ? passives.filter(p => p.name.toLowerCase().includes(f)) : passives
  if (psort === 'name') plist = [...plist].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section>
      <p className="lede">
        Plan the shortest breeding chain to a goal pal - and the odds of carrying your
        passives all the way through it.
      </p>
      <div className="modes">
        <button className={mode === 'bloodline' ? 'active' : ''} onClick={() => setMode('bloodline')}>
          From one pal <span className="muted">(any partner, wild catches OK)</span>
        </button>
        <button className={mode === 'owned' ? 'active' : ''} onClick={() => setMode('owned')}>
          Only pals I own
        </button>
      </div>
      {mode === 'bloodline' ? (
        <>
          <h3>Your pal <span className="muted">(the one with the passives)</span></h3>
          <div className="pickers">
            <PalPicker value={start} onChange={setStart} placeholder="Starting pal" />
          </div>
        </>
      ) : (
        <>
          <h3>Pals you own</h3>
          <div className="pickers">
            <PalPicker value={pick} onChange={add} placeholder="Add owned pal…" />
          </div>
          <div className="tags">
            {owned.map(id => (
              <span key={id} className="tag">
                <PalLink id={id} size={24} />
                <button onClick={() => setOwned(owned.filter(o => o !== id))}>×</button>
              </span>
            ))}
            {owned.length === 0 && <span className="muted">Nothing yet - add a few pals.</span>}
          </div>
        </>
      )}
      <h3>Target</h3>
      <div className="pickers">
        <PalPicker value={target} onChange={setTarget} placeholder="Target pal" />
      </div>
      <h3>
        Passives to carry through <span className="muted">(on your starting pal, max 4)</span>
      </h3>
      {carried.length > 0 && (
        <div className="tags">
          {carried.map(id => {
            const p = passives.find(x => x.id === id)!
            return (
              <span key={id} className="tag sel">
                {p.name}
                <button onClick={() => toggleCarried(id)}>×</button>
              </span>
            )
          })}
        </div>
      )}
      <input
        className="filter"
        value={pfilter}
        onChange={e => setPfilter(e.target.value)}
        placeholder="Filter passives…"
      />
      <SortBar options={[['tier', 'Best tier first'], ['name', 'Name']] as const} value={psort} onChange={setPsort} />
      <div className="passivegrid compact">
        {plist.map(p => (
          <button
            key={p.id}
            className={`passive ${carried.includes(p.id) ? 'sel' : ''} pr${Math.max(-1, Math.min(4, p.rank))}`}
            title={p.desc}
            onClick={() => toggleCarried(p.id)}
          >
            {p.name}
            <span className="prank">{p.rank > 0 ? '+'.repeat(p.rank) : p.rank < 0 ? '−' : ''}</span>
          </button>
        ))}
      </div>

      {(result === null || bloodline === null) && (
        <p className="warn">
          {mode === 'owned'
            ? 'Not reachable - breeding power always lands between the parents\', so you can\'t breed "down" past your best pal. Catch something stronger and retry.'
            : 'Not reachable by breeding - this pal only comes from the wild or a locked combo.'}
        </p>
      )}
      {(result || bloodline) && chainLen === 0 && <p className="lede">That's already the target.</p>}
      {chainLen > 0 && (
        <>
          <div className="odds pathodds">
            <div className="oddsrow">
              <div className="bignum">{chainLen}</div>
              <div>breeding step{chainLen === 1 ? '' : 's'} to the target</div>
            </div>
            {n > 0 && (
              <>
                <div className="oddsrow">
                  <div className="bignum">{(stepP * 100).toFixed(1)}%</div>
                  <div>
                    per egg: child keeps all {n} passive{n === 1 ? '' : 's'}
                    <div className="muted small">≈ {Number.isFinite(eggsPerStep) ? Math.ceil(eggsPerStep) : '∞'} eggs per step on average</div>
                  </div>
                </div>
                <div className="oddsrow">
                  <div className="bignum">{(chainP * 100).toFixed(2)}%</div>
                  <div>
                    whole chain first-try
                    <div className="muted small">
                      expect ≈ {Number.isFinite(totalEggs) ? Math.ceil(totalEggs) : '∞'} eggs total to carry them to the end
                    </div>
                  </div>
                </div>
                <p className="muted small">
                  Assumes each step pairs your passive-carrier with a partner that has no
                  passives of its own (keeps the pool clean). 40/30/20/10 inheritance model;
                  mutations not included.
                </p>
              </>
            )}
          </div>
          <div className="steps">
            {mode === 'bloodline' && bloodline
              ? bloodline.map((s, i) => (
                  <div key={i} className="steprow">
                    <span className="stepnum">{i + 1}</span>
                    <PalLink id={s.carrier} />
                    <span className="x">×</span>
                    <PalLink id={s.partner} />
                    <span className="x">=</span>
                    <PalLink id={s.child} strong />
                    {s.altPartners.length > 0 && (
                      <span
                        className="note"
                        title={s.altPartners.slice(0, 30).map(id => palById.get(id)!.name).join(', ')}
                      >
                        or {s.altPartners.length} other partner{s.altPartners.length === 1 ? '' : 's'}
                      </span>
                    )}
                    {n > 0 && <span className="stepodds">{(stepP * 100).toFixed(0)}% / egg</span>}
                    {s.genderNote && <span className="note">({s.genderNote})</span>}
                  </div>
                ))
              : steps.map((s: PathStep, i) => (
                  <div key={i} className="steprow">
                    <span className="stepnum">{i + 1}</span>
                    <PalLink id={s.a} />
                    <span className="x">×</span>
                    <PalLink id={s.b} />
                    <span className="x">=</span>
                    <PalLink id={s.child} strong />
                    {n > 0 && <span className="stepodds">{(stepP * 100).toFixed(0)}% / egg</span>}
                    {s.genderNote && <span className="note">({s.genderNote})</span>}
                  </div>
                ))}
          </div>
          {mode === 'owned' && result && result.altFinalPairs.length > 0 && (
            <>
              <h3>
                Alternative final pairings <span className="muted">(same chain length)</span>
              </h3>
              <div className="pairlist">
                {result.altFinalPairs.slice(0, 12).map((s, i) => (
                  <div key={i} className="pairrow">
                    <PalLink id={s.a} size={26} />
                    <span className="x">×</span>
                    <PalLink id={s.b} size={26} />
                    <span className="x">=</span>
                    <PalLink id={s.child} size={26} strong />
                    {s.genderNote && <span className="note">({s.genderNote})</span>}
                  </div>
                ))}
                {result.altFinalPairs.length > 12 && (
                  <p className="muted small">+{result.altFinalPairs.length - 12} more</p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function PassivesTab() {
  const [pool, setPool] = useState<string[]>([])
  const [desired, setDesired] = useState<string[]>([])
  const [filter, setFilter] = useState('')

  const togglePool = (id: string) => {
    if (pool.includes(id)) {
      setPool(pool.filter(p => p !== id))
      setDesired(desired.filter(p => p !== id))
    } else if (pool.length < 8) {
      setPool([...pool, id])
    }
  }
  const toggleDesired = (id: string) =>
    setDesired(desired.includes(id) ? desired.filter(p => p !== id) : [...desired, id])

  const [psort, setPsort] = useState<'tier' | 'name'>('tier')
  const atLeast = inheritChance(pool.length, desired.length)
  const exact = exactChance(pool.length, desired.length)
  const f = filter.trim().toLowerCase()
  let list = f ? passives.filter(p => p.name.toLowerCase().includes(f)) : passives
  if (psort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section>
      <p className="lede">
        Mark every passive the two parents have between them, then mark the ones you want on
        the child.
      </p>
      <h3>Parents' combined passives <span className="muted">({pool.length}/8)</span></h3>
      <input
        className="filter"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filter passives…"
      />
      <SortBar options={[['tier', 'Best tier first'], ['name', 'Name']] as const} value={psort} onChange={setPsort} />
      <div className="passivegrid">
        {list.map(p => (
          <button
            key={p.id}
            className={`passive ${pool.includes(p.id) ? 'sel' : ''} pr${Math.max(-1, Math.min(4, p.rank))}`}
            title={p.desc}
            onClick={() => togglePool(p.id)}
          >
            {p.name}
            <span className="prank">{p.rank > 0 ? '+'.repeat(p.rank) : p.rank < 0 ? '−' : ''}</span>
          </button>
        ))}
      </div>
      {pool.length > 0 && (
        <>
          <h3>Desired on the child <span className="muted">(click to mark)</span></h3>
          <div className="tags">
            {pool.map(id => {
              const p = passives.find(x => x.id === id)!
              return (
                <button
                  key={id}
                  className={`tag clickable ${desired.includes(id) ? 'sel' : ''}`}
                  onClick={() => toggleDesired(id)}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
          <div className="odds">
            <div className="oddsrow">
              <div className="bignum">{(atLeast * 100).toFixed(1)}%</div>
              <div>
                child has all <b>{desired.length}</b> desired passive{desired.length === 1 ? '' : 's'}
                <div className="muted">(possibly alongside others)</div>
              </div>
            </div>
            <div className="oddsrow">
              <div className="bignum">{(exact * 100).toFixed(1)}%</div>
              <div>
                exactly that set, nothing else from the pool
              </div>
            </div>
            <div className="oddsbar">
              <div style={{ width: `${Math.min(100, atLeast * 100)}%` }} />
            </div>
            <p className="muted small">
              Model: the child rolls 1-4 passives from the parents' combined pool
              (40 / 30 / 20 / 10%). Random wild mutations aren't modeled - treat as close
              estimates. Expected eggs for one success: ~{atLeast > 0 ? Math.ceil(1 / atLeast) : '∞'}.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

function PaldeckTab() {
  const { openPal } = useContext(DetailCtx)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<PalSort>('zukan')
  const [elem, setElem] = useState<string | null>(null)
  const f = q.trim().toLowerCase()
  let list = f
    ? pals.filter(p => p.name.toLowerCase().includes(f) || String(p.zukan).startsWith(f))
    : pals
  if (elem) list = list.filter(p => p.elements.includes(elem))
  list = sortPals(list, sort)
  return (
    <section>
      <p className="lede">Every breedable pal in 1.0 - {pals.length} of them. Click one for details.</p>
      <input className="filter" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or number…" />
      <SortBar options={PAL_SORTS} value={sort} onChange={setSort} />
      <ElementBar value={elem} onChange={setElem} />
      {elem && <p className="muted small">{list.length} {elem} pal{list.length === 1 ? '' : 's'}</p>}
      <div className="deckgrid">
        {list.map(p => {
          const tier = rarityTier(p.rarity)
          return (
            <button
              key={p.id}
              className={`deckcell ${tier.cls}`}
              onClick={() => openPal(p.id)}
              title={`${label(p)} - ${tier.name}`}
            >
              <PalIcon id={p.id} size={56} />
              <span className="deckname">{p.name}</span>
              <span className="decknum">#{p.zukan}{p.suffix}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function PassivePicker({ onPick, exclude }: { onPick: (id: string) => void; exclude: string[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const f = q.trim().toLowerCase()
  const list = passives.filter(p => !exclude.includes(p.id) && (!f || p.name.toLowerCase().includes(f))).slice(0, 40)
  return (
    <div className="picker slim">
      <input
        value={q}
        placeholder="Add passive…"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => setQ(e.target.value)}
      />
      {open && (
        <div className="dropdown">
          {list.map(p => (
            <div key={p.id} className="option" title={p.desc} onMouseDown={() => { onPick(p.id); setQ('') }}>
              <span className="optname">{p.name}</span>
              <span className="prank">{p.rank > 0 ? '+'.repeat(p.rank) : p.rank < 0 ? '−' : ''}</span>
            </div>
          ))}
          {list.length === 0 && <div className="option muted">No matches</div>}
        </div>
      )}
    </div>
  )
}

interface PlanEntry {
  palId: string | null
  passives: string[]
}

function PlanTab() {
  const [entries, setEntries] = useState<PlanEntry[]>([{ palId: null, passives: [] }])
  const [target, setTarget] = useState<string | null>(null)

  const setEntry = (i: number, e: PlanEntry) => setEntries(entries.map((x, j) => (j === i ? e : x)))
  const ready = entries.filter(e => e.palId)
  const union = [...new Set(ready.flatMap(e => e.passives))]

  const plan = useMemo(() => {
    if (ready.length === 0) return null
    if (union.length > 4) return 'too-many' as const
    // greedy merge: combine the two entries with the fewest tracked passives
    // first (cheapest eggs early, hardest rolls last)
    type Node = { species: string; set: string[] }
    let nodes: Node[] = ready.map(e => ({ species: e.palId!, set: [...new Set(e.passives)] }))
    const steps: { a: string; b: string; child: string; keep: string[]; p: number }[] = []
    while (nodes.length > 1) {
      nodes.sort((x, y) => x.set.length - y.set.length)
      const [x, y] = [nodes[0], nodes[1]]
      const keep = [...new Set([...x.set, ...y.set])]
      const child = breedOutcomes(x.species, y.species)[0]?.child
      if (!child) return null
      steps.push({ a: x.species, b: y.species, child: child.id, keep, p: inheritChance(keep.length, keep.length) })
      nodes = [{ species: child.id, set: keep }, ...nodes.slice(2)]
    }
    const merged = nodes[0]
    // then walk the bloodline to the goal species, carrying everything
    let chain: { a: string; b: string; child: string; keep: string[]; p: number }[] = []
    if (target && merged.species !== target) {
      const bl = findBloodline(merged.species, target)
      if (bl === null) return 'unreachable' as const
      const p = inheritChance(merged.set.length, merged.set.length)
      chain = bl.map(s => ({ a: s.carrier, b: s.partner, child: s.child, keep: merged.set, p: merged.set.length ? p : 1 }))
    }
    return { steps: [...steps, ...chain], final: target && merged.species !== target ? target : merged.species, set: merged.set }
  }, [JSON.stringify(entries), target])

  const allSteps = plan && typeof plan === 'object' ? plan.steps : []
  const firstTry = allSteps.reduce((acc, s) => acc * s.p, 1)
  const totalEggs = allSteps.reduce((acc, s) => acc + (s.p > 0 ? 1 / s.p : Infinity), 0)

  return (
    <section>
      <p className="lede">
        Enter the pals you have and the passives on each that you care about - get a
        step-by-step plan that merges everything onto one pal, optionally ending at a goal
        species.
      </p>
      <h3>Your pals &amp; their passives</h3>
      {entries.map((e, i) => (
        <div key={i} className="planentry">
          <PalPicker value={e.palId} onChange={id => setEntry(i, { ...e, palId: id })} placeholder={`Pal ${i + 1}`} />
          <PassivePicker
            exclude={e.passives}
            onPick={pid => e.passives.length < 4 && setEntry(i, { ...e, passives: [...e.passives, pid] })}
          />
          <div className="tags">
            {e.passives.map(pid => {
              const p = passives.find(x => x.id === pid)!
              return (
                <span key={pid} className="tag sel">
                  {p.name}
                  <button onClick={() => setEntry(i, { ...e, passives: e.passives.filter(x => x !== pid) })}>×</button>
                </span>
              )
            })}
          </div>
          {entries.length > 1 && (
            <button className="modal-btn" onClick={() => setEntries(entries.filter((_, j) => j !== i))}>remove</button>
          )}
        </div>
      ))}
      <button className="modal-btn" onClick={() => setEntries([...entries, { palId: null, passives: [] }])}>
        + Add another pal
      </button>
      <h3>Goal species <span className="muted">(optional - where the bloodline should end up)</span></h3>
      <div className="pickers">
        <PalPicker value={target} onChange={setTarget} placeholder="Goal pal (optional)" />
      </div>

      {plan === 'too-many' && (
        <p className="warn">
          {union.length} passives tracked - a pal can only hold 4. Trim the list.
        </p>
      )}
      {plan === 'unreachable' && (
        <p className="warn">Goal species can't be reached by breeding from the merged line.</p>
      )}
      {plan && typeof plan === 'object' && allSteps.length === 0 && (
        <p className="lede">Nothing to breed - one pal, already at the goal. It's done.</p>
      )}
      {plan && typeof plan === 'object' && allSteps.length > 0 && (
        <>
          <div className="odds pathodds">
            <div className="oddsrow">
              <div className="bignum">{allSteps.length}</div>
              <div>
                breeding step{allSteps.length === 1 ? '' : 's'} → <PalLink id={plan.final} strong />
                {plan.set.length > 0 && (
                  <div className="muted small">carrying: {plan.set.map(pid => passives.find(p => p.id === pid)!.name).join(', ')}</div>
                )}
              </div>
            </div>
            {plan.set.length > 0 && (
              <>
                <div className="oddsrow">
                  <div className="bignum">{(firstTry * 100).toFixed(2)}%</div>
                  <div>whole plan first-try</div>
                </div>
                <div className="oddsrow">
                  <div className="bignum">≈{Number.isFinite(totalEggs) ? Math.ceil(totalEggs) : '∞'}</div>
                  <div>eggs expected in total</div>
                </div>
                <p className="muted small">
                  Assumes parents carry only the tracked passives (breed away junk passives
                  first). 40/30/20/10 inheritance model; mutations not included. Merge order:
                  fewest-passive pals first, so the hard rolls come as late as possible.
                </p>
              </>
            )}
          </div>
          <div className="steps">
            {allSteps.map((s, i) => (
              <div key={i} className="steprow">
                <span className="stepnum">{i + 1}</span>
                <PalLink id={s.a} />
                <span className="x">×</span>
                <PalLink id={s.b} />
                <span className="x">=</span>
                <PalLink id={s.child} strong />
                {s.keep.length > 0 && (
                  <span className="note">
                    keep: {s.keep.map(pid => passives.find(p => p.id === pid)!.name).join(', ')}
                  </span>
                )}
                {s.keep.length > 0 && <span className="stepodds">{(s.p * 100).toFixed(0)}% / egg</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function MapTab() {
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const f = q.trim().toLowerCase()
  const spawnable = pals.filter(p => spawnsFor(p.id))
  const list = f
    ? spawnable.filter(p => p.name.toLowerCase().includes(f) || String(p.zukan).startsWith(f))
    : spawnable
  return (
    <section>
      <p className="lede">
        Where every pal spawns - pick one from the list. Scroll to zoom, drag to pan;
        {' '}{spawnable.length} pals have wild spawn areas.
      </p>
      <div className="maptab">
        <div className="maptab-list">
          <input className="filter" value={q} onChange={e => setQ(e.target.value)} placeholder="Search pals…" />
          <div className="maptab-pals">
            {list.map(p => {
              const inf = spawnsFor(p.id)!
              const treeOnly = inf.main.day.length === 0 && inf.main.night.length === 0
              return (
                <button
                  key={p.id}
                  className={`maplist-row ${sel === p.id ? 'sel' : ''}`}
                  onClick={() => setSel(p.id)}
                >
                  <PalIcon id={p.id} size={28} />
                  <span className="maplist-name">{p.name}</span>
                  <span className="decknum">#{p.zukan}{p.suffix}</span>
                  {treeOnly && <span className="treetag" title="World Tree only">🌳</span>}
                </button>
              )
            })}
            {list.length === 0 && <p className="muted">No matches.</p>}
          </div>
        </div>
        <div className="maptab-map">
          {sel && (
            <div className="maptab-selected">
              <PalLink id={sel} strong showZukan />
              <span className="muted small">(click for details)</span>
            </div>
          )}
          <SpawnMapView palId={sel} key={sel ?? 'none'} />
          {!sel && <p className="muted">Select a pal to highlight its spawn areas.</p>}
        </div>
      </div>
    </section>
  )
}

const KILLS_KEY = 'palworld-boss-kills'

function loadKills(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KILLS_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

function BossMapTab() {
  const [kills, setKills] = useState<Set<string>>(loadKills)
  const [which, setWhich] = useState<'main' | 'tree'>('main')
  const [full, setFull] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<[number, number]>([0, 0])
  const [hover, setHover] = useState<[number, number] | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<null | { x: number; y: number; px: number; py: number }>(null)
  const viewRef = useRef({ zoom: 1, pan: [0, 0] as [number, number] })
  viewRef.current = { zoom, pan }

  const toggle = (id: string) => {
    setKills(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(KILLS_KEY, JSON.stringify([...next])) } catch { /* file:// storage may be unavailable */ }
      return next
    })
  }
  const resetKills = () => {
    setKills(new Set())
    try { localStorage.removeItem(KILLS_KEY) } catch { /* ignore */ }
  }

  const shown = worldBosses.filter(b => b.m === which).sort((a, b) => a.lv - b.lv)
  const killed = worldBosses.filter(b => kills.has(b.id)).length

  const clampPan = (p: [number, number], z: number): [number, number] => {
    const lim = (z - 1) / 2 / z
    return [Math.max(-lim, Math.min(lim, p[0])), Math.max(-lim, Math.min(lim, p[1]))]
  }
  const baseRect = () => {
    const r = wrapRef.current!.getBoundingClientRect()
    const size = Math.min(r.width, r.height)
    return { left: r.left + (r.width - size) / 2, top: r.top + (r.height - size) / 2, size }
  }
  const toMapFrac = (clientX: number, clientY: number): [number, number] => {
    const rect = baseRect()
    const { zoom: z, pan: p } = viewRef.current
    const sx = (clientX - rect.left) / rect.size
    const sy = (clientY - rect.top) / rect.size
    return [(sx - 0.5) / z + 0.5 - p[0], (sy - 0.5) / z + 0.5 - p[1]]
  }

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [mu, mv] = toMapFrac(e.clientX, e.clientY)
      const { zoom: z } = viewRef.current
      const nz = Math.max(1, Math.min(10, z * (e.deltaY < 0 ? 1.25 : 0.8)))
      const rect = baseRect()
      const sx = (e.clientX - rect.left) / rect.size
      const sy = (e.clientY - rect.top) / rect.size
      const lim = (nz - 1) / 2 / nz
      setZoom(nz)
      setPan([
        Math.max(-lim, Math.min(lim, (sx - 0.5) / nz + 0.5 - mu)),
        Math.max(-lim, Math.min(lim, (sy - 0.5) / nz + 0.5 - mv)),
      ])
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [full])

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const { pan: p } = viewRef.current
    dragRef.current = { x: e.clientX, y: e.clientY, px: p[0], py: p[1] }
    const move = (ev: MouseEvent) => {
      if (!dragRef.current || !wrapRef.current) return
      const rect = baseRect()
      const { zoom: z } = viewRef.current
      const dx = (ev.clientX - dragRef.current.x) / rect.size / z
      const dy = (ev.clientY - dragRef.current.y) / rect.size / z
      setPan(clampPan([dragRef.current.px + dx, dragRef.current.py + dy], z))
    }
    const up = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const [u, v] = toMapFrac(e.clientX, e.clientY)
    setHover(u >= 0 && u <= 1 && v >= 0 && v <= 1 ? gameCoords(u, v, which) : null)
  }
  const reset = () => { setZoom(1); setPan([0, 0]) }

  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setFull(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [full])

  const mapView = (
    <>
      <div className="maptoolbar">
        <span className="mapnavbtns">
          <button className={`modal-btn ${which === 'main' ? 'primary' : ''}`} onClick={() => { setWhich('main'); reset() }}>World</button>
          <button className={`modal-btn ${which === 'tree' ? 'primary' : ''}`} onClick={() => { setWhich('tree'); reset() }}>World Tree</button>
        </span>
        <span className="mapnavbtns">
          {zoom > 1 && <button className="modal-btn" onClick={reset}>reset zoom</button>}
          <button className="modal-btn" onClick={() => setFull(!full)}>{full ? '🗗 Exit fullscreen' : '🗖 Fullscreen'}</button>
        </span>
      </div>
      <div
        className="mapwrap"
        ref={wrapRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <div className="mapinner" style={{ transform: `scale(${zoom}) translate(${pan[0] * 100}%, ${pan[1] * 100}%)` }}>
          <img src={which === 'main' ? worldMap : treeMap} alt="Map" draggable={false} />
          {shown.map(b => {
            const dead = kills.has(b.id)
            const pal = palById.get(b.pal)
            return (
              <button
                key={b.id}
                className={`bossmark ${dead ? 'dead' : ''}`}
                style={{ left: `${b.u * 100}%`, top: `${b.v * 100}%`, transform: `translate(-50%, -50%) scale(${1 / Math.sqrt(zoom)})` }}
                title={`${pal?.name ?? b.pal} Lv ${b.lv}${dead ? ' (defeated - click to restore)' : ' (click to mark defeated)'}`}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => toggle(b.id)}
              >
                <img src={palIconSrc(b.pal)} alt="" />
                <span className="bosslv">{b.lv}</span>
                {dead && (
                  <svg className="bossx" viewBox="0 0 40 40">
                    <line x1="5" y1="5" x2="35" y2="35" />
                    <line x1="35" y1="5" x2="5" y2="35" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
        {hover && <div className="maphover">({hover[0]}, {hover[1]})</div>}
      </div>
      <div className="maplegend">
        <span className="note">click a boss on the map or in the list to mark it defeated</span>
        <span className="mapcentroid">{killed}/{worldBosses.length} defeated</span>
      </div>
    </>
  )

  return (
    <section>
      <p className="lede">
        Every world (alpha) boss in 1.0 - all {worldBosses.length} of them. Check bosses off
        as you defeat them; a red X marks them on the map. Progress is saved in your browser.
      </p>
      <div className="maptab">
        <div className="maptab-list">
          <div className="bosshead">
            <b>{killed}/{worldBosses.length}</b> defeated
            {killed > 0 && <button className="modal-btn" onClick={resetKills}>reset</button>}
          </div>
          <div className="maptab-pals">
            {shown.map(b => {
              const pal = palById.get(b.pal)
              const dead = kills.has(b.id)
              return (
                <button key={b.id} className={`maplist-row boss ${dead ? 'dead' : ''}`} onClick={() => toggle(b.id)}>
                  <span className="bosscheck">{dead ? '☑' : '☐'}</span>
                  <PalIcon id={b.pal} size={28} />
                  <span className="maplist-name">{pal?.name ?? b.pal}</span>
                  <span className="decknum">Lv {b.lv}</span>
                </button>
              )
            })}
          </div>
          {which === 'main'
            ? <p className="muted small">7 more bosses on the World Tree map</p>
            : <p className="muted small">65 bosses on the world map</p>}
        </div>
        <div className="maptab-map">
          {full
            ? createPortal(
                <div className="modal-backdrop mapdrop full"><div className="mapmodal full">{mapView}</div></div>,
                document.body,
              )
            : <div className="mapview">{mapView}</div>}
        </div>
      </div>
    </section>
  )
}

const PDEX_SORTS = [
  ['best', 'Best tier first'],
  ['worst', 'Worst tier first'],
  ['name', 'Name'],
] as const
type PdexSort = (typeof PDEX_SORTS)[number][0]

function PassiveDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const p = passives.find(x => x.id === id)!
  const totalWeight = useMemo(() => passives.reduce((a, x) => a + x.weight, 0), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-nav">
          <button className="modal-btn close" onClick={onClose}>× Close</button>
        </div>
        <div className="pdetail-head">
          <h2>{p.name}</h2>
          <span className={`prank big r${p.rank}`}>
            {p.rank > 0 ? '+'.repeat(p.rank) : p.rank < 0 ? '−' : '·'}
          </span>
        </div>
        <p className="pdetail-desc">{p.desc}</p>
        {p.effects.length > 0 && (
          <>
            <h3>Effects</h3>
            <div className="deckstats">
              {p.effects.map((e, i) => (
                <div key={i}>
                  <span className="statlabel">{e.t}</span>
                  {e.v !== 0 && <b>{e.v > 0 ? '+' : ''}{e.v}{e.t.includes('suitability') ? '' : '%'}</b>}
                  {e.v === 0 && <b>✓</b>}
                </div>
              ))}
            </div>
          </>
        )}
        <h3>Details</h3>
        <div className="deckstats">
          <div><span className="statlabel">Tier</span><b>{p.rank > 0 ? `+${p.rank}` : p.rank}</b></div>
          <div>
            <span className="statlabel">Wild roll chance</span>
            <b>{totalWeight > 0 && p.weight > 0 ? `${((p.weight / totalWeight) * 100).toFixed(1)}%` : 'never rolled'}</b>
            <span className="muted small"> (per passive slot on a wild pal)</span>
          </div>
          {p.rareOnly && <div><span className="statlabel">Source</span><b>lucky / rare pals only</b></div>}
          {p.special && <div><span className="statlabel">Source</span><b>innate to specific pals / special events</b></div>}
          <div><span className="statlabel">Internal id</span><b>{p.id}</b></div>
        </div>
      </div>
    </div>
  )
}

function PassiveDexTab() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<PdexSort>('best')
  const [sel, setSel] = useState<string | null>(null)
  const f = q.trim().toLowerCase()
  let list = f
    ? passives.filter(p => p.name.toLowerCase().includes(f) || p.desc.toLowerCase().includes(f))
    : [...passives]
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'worst') list.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  else list.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
  return (
    <section>
      <p className="lede">
        All {passives.length} passive skills a pal can have, with their in-game descriptions.
        Tier runs from −1 (negative) to +5 (best). Click one for details.
      </p>
      <input className="filter" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or description…" />
      <SortBar options={PDEX_SORTS} value={sort} onChange={setSort} />
      <div className="pdexlist">
        {list.map(p => (
          <button key={p.id} className={`pdexrow clickable pr${Math.max(-1, Math.min(4, p.rank))}`} onClick={() => setSel(p.id)}>
            <span className="pdexname">
              {p.name}
              <span className="prank">{p.rank > 0 ? '+'.repeat(p.rank) : p.rank < 0 ? '−' : ''}</span>
            </span>
            <span className="pdexdesc">{p.desc || <span className="muted">(no description)</span>}</span>
          </button>
        ))}
        {list.length === 0 && <p className="muted">No matches.</p>}
      </div>
      {sel && <PassiveDetailModal id={sel} onClose={() => setSel(null)} />}
    </section>
  )
}

const TABS = [
  ['breed', '🥚', 'Breed'],
  ['reverse', '🎯', 'Find Parents'],
  ['path', '🗺️', 'Path Finder'],
  ['plan', '🧬', 'Plan Builder'],
  ['passives', '✨', 'Passive Odds'],
  ['pdex', '📜', 'Passive Skills'],
  ['map', '🌍', 'Spawn Map'],
  ['bosses', '👑', 'Boss Tracker'],
  ['deck', '📖', 'Paldeck'],
] as const

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('breed')
  const [detailStack, setDetailStack] = useState<string[]>([])
  const [reverseTarget, setReverseTarget] = useState<string | null>(null)
  const [pathStart, setPathStart] = useState<string | null>(null)

  const api: DetailApi = {
    openPal: id => setDetailStack(s => (s[s.length - 1] === id ? s : [...s, id])),
    gotoReverse: id => {
      setDetailStack([])
      setReverseTarget(id)
      setTab('reverse')
    },
    gotoPath: id => {
      setDetailStack([])
      setPathStart(id)
      setTab('path')
    },
  }
  const top = detailStack[detailStack.length - 1]

  return (
    <DetailCtx.Provider value={api}>
      <div className="app">
        <header>
          <div className="title">
            <span className="egg">🥚</span>
            <div>
              <h1>Palworld Breeding Calculator</h1>
              <p className="muted">Data extracted directly from the Palworld 1.0 game files</p>
            </div>
          </div>
        </header>
        <nav>
          {TABS.map(([id, emoji, name]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <span className="tabemoji">{emoji}</span> {name}
            </button>
          ))}
        </nav>
        <div className={tab === 'breed' ? '' : 'hidden'}><BreedTab /></div>
        <div className={tab === 'reverse' ? '' : 'hidden'}><ReverseTab target={reverseTarget} setTarget={setReverseTarget} /></div>
        <div className={tab === 'path' ? '' : 'hidden'}><PathTab start={pathStart} setStart={setPathStart} /></div>
        <div className={tab === 'plan' ? '' : 'hidden'}><PlanTab /></div>
        <div className={tab === 'passives' ? '' : 'hidden'}><PassivesTab /></div>
        <div className={tab === 'pdex' ? '' : 'hidden'}><PassiveDexTab /></div>
        <div className={tab === 'map' ? '' : 'hidden'}><MapTab /></div>
        <div className={tab === 'bosses' ? '' : 'hidden'}><BossMapTab /></div>
        <div className={tab === 'deck' ? '' : 'hidden'}><PaldeckTab /></div>
        <footer className="muted small">
          Breeding data, names and icons extracted from Pal-Windows.pak (v1.0) ·{' '}
          {pals.length} pals · 185 unique combos
        </footer>
        {top && (
          <PalDetailModal
            id={top}
            hasBack={detailStack.length > 1}
            onBack={() => setDetailStack(s => s.slice(0, -1))}
            onClose={() => setDetailStack([])}
          />
        )}
      </div>
    </DetailCtx.Provider>
  )
}
