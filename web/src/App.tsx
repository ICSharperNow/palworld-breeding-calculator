import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react'
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
import { rarityTier, genderText, ELEMENT_COLORS } from './lib/ui'
import { spawnsFor, worldMap, SPAWN_GRID } from './lib/spawns'
import { PalPicker, ElementChips, PalIcon } from './PalPicker'

function SpawnMapOverlay({ palId, onClose }: { palId: string; onClose: () => void }) {
  const pal = palById.get(palId)!
  const info = spawnsFor(palId)!
  const [showDay, setShowDay] = useState(true)
  const [showNight, setShowNight] = useState(true)
  const canvasRef = (node: HTMLCanvasElement | null) => {
    if (!node || !info) return
    const ctx = node.getContext('2d')!
    const W = node.width
    ctx.clearRect(0, 0, W, W)
    const cell = W / SPAWN_GRID
    const dot = Math.max(2.4, cell * 1.15)
    const dayKeys = new Set(info.day.map(([x, y]) => y * SPAWN_GRID + x))
    const nightKeys = new Set(info.night.map(([x, y]) => y * SPAWN_GRID + x))
    const draw = (keys: Iterable<number>, color: string) => {
      ctx.fillStyle = color
      for (const k of keys) ctx.fillRect((k % SPAWN_GRID) * cell, Math.floor(k / SPAWN_GRID) * cell, dot, dot)
    }
    if (showDay && showNight) {
      draw([...dayKeys].filter(k => !nightKeys.has(k)), 'rgba(255, 200, 60, 0.85)')
      draw([...nightKeys].filter(k => !dayKeys.has(k)), 'rgba(110, 170, 255, 0.85)')
      draw([...dayKeys].filter(k => nightKeys.has(k)), 'rgba(126, 231, 135, 0.85)')
    } else if (showDay) {
      draw(dayKeys, 'rgba(255, 200, 60, 0.85)')
    } else if (showNight) {
      draw(nightKeys, 'rgba(110, 170, 255, 0.85)')
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop mapdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mapmodal">
        <div className="modal-nav">
          <span className="maptitle">
            <PalIcon id={palId} size={30} />
            {pal.name} — spawn locations
          </span>
          <button className="modal-btn close" onClick={onClose}>× Close</button>
        </div>
        <div className="mapwrap">
          <img src={worldMap} alt="World map" draggable={false} />
          <canvas ref={canvasRef} width={1024} height={1024} key={`${showDay}-${showNight}`} />
        </div>
        <div className="maplegend">
          <button className={`legend day ${showDay ? 'on' : ''}`} onClick={() => setShowDay(!showDay)}>
            ☀ Day {info.day.length ? '' : '(none)'}
          </button>
          <button className={`legend night ${showNight ? 'on' : ''}`} onClick={() => setShowNight(!showNight)}>
            ☾ Night {info.night.length ? '' : '(none)'}
          </button>
          {showDay && showNight && <span className="note"><span className="swatch both" /> = day &amp; night</span>}
          {info.tree && <span className="note">also spawns in the World Tree (off this map)</span>}
        </div>
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

function PalCard({ pal, note, big, clickable = true }: { pal: Pal; note?: string; big?: boolean; clickable?: boolean }) {
  const { openPal } = useContext(DetailCtx)
  const tier = rarityTier(pal.rarity)
  return (
    <div
      className={`palcard ${tier.cls} ${big ? 'big' : ''} ${clickable ? 'clickable' : ''}`}
      onClick={clickable ? () => openPal(pal.id) : undefined}
      title={clickable ? `${pal.name} - details` : undefined}
    >
      <div className="palcard-icon">
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
  useEffect(() => setShowMap(false), [id])

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
        <PalCard pal={pal} big clickable={false} />
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
            <span className="note">No wild spawns — breeding or special sources only.</span>
          )}
          <button className="modal-btn primary" onClick={() => gotoReverse(id)}>🎯 Find all parents</button>
          <button className="modal-btn primary" onClick={() => gotoPath(id)}>🗺️ Plan path from it</button>
        </div>
      </div>
      {showMap && <SpawnMapOverlay palId={id} onClose={() => setShowMap(false)} />}
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

const TABS = [
  ['breed', '🥚', 'Breed'],
  ['reverse', '🎯', 'Find Parents'],
  ['path', '🗺️', 'Path Finder'],
  ['plan', '🧬', 'Plan Builder'],
  ['passives', '✨', 'Passive Odds'],
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
