import spawnsJson from '../data/spawns.json'
import worldMapUrl from '../data/worldmap.webp'
import treeMapUrl from '../data/treemap.webp'

interface RawEntry {
  d?: number[]
  n?: number[]
  td?: number[]
  tn?: number[]
}

type Bounds = [number, number, number, number] // minX, maxX, minY, maxY (world units)

const raw = spawnsJson as unknown as {
  grid: number
  bounds: { main: Bounds; tree: Bounds }
  pals: Record<string, RawEntry>
}

export const SPAWN_GRID = raw.grid
export const worldMap = worldMapUrl
export const treeMap = treeMapUrl
export const MAP_BOUNDS = raw.bounds

// In-game map coordinates are world units divided by this factor, with the
// axes swapped (displayed x = world Y, displayed y = world X).
const WORLD_TO_GAME = 459.86

/** Map-space (u,v in 0..1) to approximate in-game coordinates. */
export function gameCoords(u: number, v: number, which: 'main' | 'tree'): [number, number] {
  const [minX, maxX, minY, maxY] = MAP_BOUNDS[which]
  const worldY = minY + u * (maxY - minY)
  const worldX = minX + (1 - v) * (maxX - minX)
  return [Math.round(worldY / WORLD_TO_GAME), Math.round(worldX / WORLD_TO_GAME)]
}

export interface SpawnInfo {
  /** spawn cells per map, each 0..grid-1 as [x, y] */
  main: { day: [number, number][]; night: [number, number][] }
  tree: { day: [number, number][]; night: [number, number][] }
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
  const info = e
    ? {
        main: { day: decode(e.d), night: decode(e.n) },
        tree: { day: decode(e.td), night: decode(e.tn) },
      }
    : null
  cache.set(palId, info)
  return info
}

/** Centroid of a point set in grid space, or null if empty. */
export function centroid(pts: [number, number][][]): [number, number] | null {
  let sx = 0
  let sy = 0
  let c = 0
  for (const set of pts) {
    for (const [x, y] of set) {
      sx += x
      sy += y
      c++
    }
  }
  return c ? [sx / c, sy / c] : null
}
