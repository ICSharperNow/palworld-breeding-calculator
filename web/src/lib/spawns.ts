import spawnsJson from '../data/spawns.json'
import worldMapUrl from '../data/worldmap.webp'

interface RawEntry {
  d?: number[]
  n?: number[]
  t?: number
}

const raw = spawnsJson as { grid: number; pals: Record<string, RawEntry> }

export const SPAWN_GRID = raw.grid
export const worldMap = worldMapUrl

export interface SpawnInfo {
  /** day spawn cells, each 0..grid-1 as [x, y] */
  day: [number, number][]
  night: [number, number][]
  /** also spawns in the World Tree / off-map areas */
  tree: boolean
}

function decode(deltas: number[] | undefined): [number, number][] {
  if (!deltas) return []
  const out: [number, number][] = []
  let acc = 0
  for (const d of deltas) {
    acc += d
    out.push([acc % SPAWN_GRID, Math.floor(acc / SPAWN_GRID)])
  }
  return out
}

const cache = new Map<string, SpawnInfo | null>()

export function spawnsFor(palId: string): SpawnInfo | null {
  if (cache.has(palId)) return cache.get(palId)!
  const e = raw.pals[palId]
  const info = e ? { day: decode(e.d), night: decode(e.n), tree: !!e.t } : null
  cache.set(palId, info)
  return info
}
