import palsJson from '../data/pals.json'
import combosJson from '../data/combos.json'

export interface Pal {
  id: string
  name: string
  zukan: number
  suffix: string
  rank: number
  prio: number
  ignoreCombi: boolean
  maleProb: number
  elements: string[]
  rarity: number
  stats: {
    hp: number
    atk: number
    def: number
    workSpeed: number
    stamina: number
    food: number
    run: number
    ride: number
  }
  nocturnal: boolean
  work: Record<string, number>
}

export type Gender = 'Male' | 'Female'

export interface UniqueCombo {
  a: string
  aG: Gender | null
  b: string
  bG: Gender | null
  child: string
}

export const pals = palsJson as Pal[]
export const combos = combosJson as UniqueCombo[]

export const palById = new Map<string, Pal>(pals.map(p => [p.id, p]))
const palIdx = new Map<string, number>(pals.map((p, i) => [p.id, i]))

export function label(p: Pal): string {
  return `#${p.zukan}${p.suffix} ${p.name}`
}

// Candidates for the rank formula: everything not flagged IgnoreCombi,
// sorted by CombiRank for binary search.
const candidates = pals
  .filter(p => !p.ignoreCombi)
  .sort((a, b) => a.rank - b.rank || a.prio - b.prio || palIdx.get(a.id)! - palIdx.get(b.id)!)

export interface Outcome {
  child: Pal
  // set when the result only applies for specific parent genders,
  // e.g. "Katress (F) × Wixen (M)"
  genderNote?: string
}

function comboMatches(c: UniqueCombo, aId: string, bId: string): { aG: Gender | null; bG: Gender | null } | null {
  if (c.a === aId && c.b === bId) return { aG: c.aG, bG: c.bG }
  if (c.a === bId && c.b === aId) return { aG: c.bG, bG: c.aG }
  return null
}

function closestByRank(target: number): Pal {
  // binary search over candidates, then resolve ties by |diff|, prio, table order
  let lo = 0
  let hi = candidates.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (candidates[mid].rank < target) lo = mid + 1
    else hi = mid
  }
  let best: Pal | null = null
  for (let i = Math.max(0, lo - 2); i < Math.min(candidates.length, lo + 3); i++) {
    const c = candidates[i]
    if (
      best === null ||
      Math.abs(c.rank - target) < Math.abs(best.rank - target) ||
      (Math.abs(c.rank - target) === Math.abs(best.rank - target) &&
        (c.prio < best.prio ||
          (c.prio === best.prio && palIdx.get(c.id)! < palIdx.get(best.id)!)))
    ) {
      best = c
    }
  }
  return best!
}

/**
 * All possible children of a pair. Usually one outcome; the gendered
 * unique combos (Katress × Wixen) yield two, annotated with genderNote.
 */
export function breedOutcomes(aId: string, bId: string): Outcome[] {
  const a = palById.get(aId)
  const b = palById.get(bId)
  if (!a || !b) return []

  // same species always breeds true
  if (aId === bId) return [{ child: a }]

  const matches: Outcome[] = []
  for (const c of combos) {
    const m = comboMatches(c, aId, bId)
    if (!m) continue
    const child = palById.get(c.child)!
    if (m.aG || m.bG) {
      const note = `${a.name} (${m.aG === 'Male' ? 'M' : 'F'}) × ${b.name} (${m.bG === 'Male' ? 'M' : 'F'})`
      matches.push({ child, genderNote: note })
    } else {
      matches.push({ child })
    }
  }
  if (matches.length > 0) return matches

  const target = Math.floor((a.rank + b.rank + 1) / 2)
  return [{ child: closestByRank(target) }]
}

/** Primary child of a pair (first outcome). */
export function breedChild(aId: string, bId: string): Pal | null {
  return breedOutcomes(aId, bId)[0]?.child ?? null
}

export interface ParentPair {
  a: Pal
  b: Pal
  genderNote?: string
}

/** Every parent pair whose offspring is `childId`. */
export function parentsFor(childId: string): ParentPair[] {
  const out: ParentPair[] = []
  for (let i = 0; i < pals.length; i++) {
    for (let j = i; j < pals.length; j++) {
      for (const o of breedOutcomes(pals[i].id, pals[j].id)) {
        if (o.child.id === childId) {
          out.push({ a: pals[i], b: pals[j], genderNote: o.genderNote })
        }
      }
    }
  }
  return out
}

export interface PathStep {
  a: string
  b: string
  child: string
  genderNote?: string
}

export interface PathResult {
  steps: PathStep[]
  /** other same-length final pairings that also produce the target */
  altFinalPairs: PathStep[]
}

export interface BloodlineStep {
  /** the pal carrying your passives into this step */
  carrier: string
  /** the partner to breed it with */
  partner: string
  child: string
  genderNote?: string
  /** other partners that give the same child from this carrier */
  altPartners: string[]
}

/**
 * Shortest bloodline chain from one pal to a target, where every step
 * breeds the current descendant with ANY pal (wild catches allowed) -
 * the paldb-style planner. The child of each step becomes the carrier
 * of the next, so passives can ride the whole chain.
 */
export function findBloodline(startId: string, targetId: string): BloodlineStep[] | null {
  if (startId === targetId) return []
  // BFS over single-pal states
  const prev = new Map<string, { carrier: string; partner: string; genderNote?: string }>()
  prev.set(startId, { carrier: '', partner: '' })
  let frontier = [startId]
  while (frontier.length > 0 && !prev.has(targetId)) {
    const next: string[] = []
    for (const cur of frontier) {
      for (const partner of pals) {
        for (const o of breedOutcomes(cur, partner.id)) {
          if (prev.has(o.child.id)) continue
          prev.set(o.child.id, { carrier: cur, partner: partner.id, genderNote: o.genderNote })
          next.push(o.child.id)
        }
      }
    }
    frontier = next
  }
  if (!prev.has(targetId)) return null

  const chain: BloodlineStep[] = []
  let cur = targetId
  while (cur !== startId) {
    const p = prev.get(cur)!
    chain.push({ carrier: p.carrier, partner: p.partner, child: cur, genderNote: p.genderNote, altPartners: [] })
    cur = p.carrier
  }
  chain.reverse()

  // collect alternative partners per step (same carrier, same child)
  for (const step of chain) {
    for (const partner of pals) {
      if (partner.id === step.partner) continue
      if (breedOutcomes(step.carrier, partner.id).some(o => o.child.id === step.child)) {
        step.altPartners.push(partner.id)
      }
    }
  }
  return chain
}

/**
 * Fewest-generations breeding plan from an owned set to a target.
 * Round-based BFS: each round breeds every known pair; newly reachable
 * pals join the pool. Returns the steps for the target (in breeding
 * order) plus alternative final pairings, or null if unreachable.
 */
export function findPath(ownedIds: string[], targetId: string): PathResult | null {
  const known = new Map<string, PathStep | null>() // id -> how obtained (null = owned)
  const round = new Map<string, number>()
  for (const id of ownedIds) {
    known.set(id, null)
    round.set(id, 0)
  }
  if (known.has(targetId)) return { steps: [], altFinalPairs: [] }

  for (let r = 1; r <= 12; r++) {
    const ids = [...known.keys()]
    const discovered = new Map<string, PathStep>()
    for (let i = 0; i < ids.length; i++) {
      for (let j = i; j < ids.length; j++) {
        for (const o of breedOutcomes(ids[i], ids[j])) {
          if (known.has(o.child.id) || discovered.has(o.child.id)) continue
          discovered.set(o.child.id, {
            a: ids[i],
            b: ids[j],
            child: o.child.id,
            genderNote: o.genderNote,
          })
        }
      }
    }
    if (discovered.size === 0) return null
    for (const [id, step] of discovered) {
      known.set(id, step)
      round.set(id, r)
    }
    if (known.has(targetId)) break
  }
  if (!known.has(targetId)) return null

  // unwind the tree for the target only
  const steps: PathStep[] = []
  const need = [targetId]
  const seen = new Set<string>()
  while (need.length > 0) {
    const id = need.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const step = known.get(id)
    if (step) {
      steps.push(step)
      need.push(step.a, step.b)
    }
  }
  steps.reverse()

  // alternative final pairings of the same total length: any known pair
  // whose child is the target and whose parents were reached early enough
  const targetRound = round.get(targetId)!
  const primary = known.get(targetId)!
  const altFinalPairs: PathStep[] = []
  const ids = [...known.keys()]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i; j < ids.length; j++) {
      if (Math.max(round.get(ids[i])!, round.get(ids[j])!) >= targetRound) continue
      for (const o of breedOutcomes(ids[i], ids[j])) {
        if (o.child.id !== targetId) continue
        if (primary && ids[i] === primary.a && ids[j] === primary.b) continue
        altFinalPairs.push({ a: ids[i], b: ids[j], child: targetId, genderNote: o.genderNote })
      }
    }
  }
  return { steps, altFinalPairs }
}
