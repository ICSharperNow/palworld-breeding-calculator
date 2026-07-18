import passivesJson from '../data/passives.json'

export interface Passive {
  id: string
  name: string
  desc: string
  rank: number
  effects: { t: string; v: number }[]
  weight: number
  rareOnly: boolean
  /** innate / special-source passive that never enters the wild lottery */
  special: boolean
}

export const passives = passivesJson as Passive[]
export const passiveById = new Map<string, Passive>(passives.map(p => [p.id, p]))

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

// Inherited-passive-count weights (community-datamined model, unchanged
// from EA as far as is known): the child rolls how many passives to take
// from the parents' combined pool.
const COUNT_WEIGHTS: [number, number][] = [
  [1, 0.4],
  [2, 0.3],
  [3, 0.2],
  [4, 0.1],
]

/**
 * P(child inherits at least the desired passives) given the union of the
 * parents' passives. Random mutations are ignored, so real odds are
 * slightly lower for "exact" goals and slightly different overall.
 */
export function inheritChance(unionSize: number, desiredSize: number): number {
  if (desiredSize === 0) return 1
  if (desiredSize > unionSize || desiredSize > 4) return 0
  let p = 0
  for (const [k0, w] of COUNT_WEIGHTS) {
    const k = Math.min(k0, unionSize) // pool smaller than roll: take everything
    if (k < desiredSize) continue
    p += (w * choose(unionSize - desiredSize, k - desiredSize)) / choose(unionSize, k)
  }
  return p
}

/** P(child inherits exactly the desired set, nothing else from the pool). */
export function exactChance(unionSize: number, desiredSize: number): number {
  if (desiredSize > unionSize || desiredSize > 4 || desiredSize === 0) return 0
  let p = 0
  for (const [k0, w] of COUNT_WEIGHTS) {
    const k = Math.min(k0, unionSize)
    if (k === desiredSize) p += w / choose(unionSize, k)
  }
  return p
}
