import { Pal } from './breeding'

export const ELEMENT_COLORS: Record<string, string> = {
  Normal: '#8f9aa6',
  Fire: '#e2574c',
  Water: '#4d9de0',
  Leaf: '#57a75c',
  Electricity: '#d9a520',
  Ice: '#5bb8c9',
  Earth: '#b0855b',
  Dark: '#8e6bb8',
  Dragon: '#5f6ec7',
}

export const ELEMENT_ICONS: Record<string, string> = {
  Normal: '○',
  Fire: '🔥',
  Water: '💧',
  Leaf: '🌿',
  Electricity: '⚡',
  Ice: '❄️',
  Earth: '⛰️',
  Dark: '🌙',
  Dragon: '🐉',
}

export interface RarityTier {
  name: string
  cls: string
}

export function rarityTier(r: number): RarityTier {
  if (r >= 20) return { name: 'Mythic', cls: 'mythic' }
  if (r >= 10) return { name: 'Legendary', cls: 'legendary' }
  if (r >= 8) return { name: 'Epic', cls: 'epic' }
  if (r >= 5) return { name: 'Rare', cls: 'rare' }
  return { name: 'Common', cls: 'common' }
}

export function genderText(p: Pal): string {
  return `${p.maleProb}% ♂ / ${100 - p.maleProb}% ♀`
}

// what deals bonus damage TO each element (Palworld type chart)
export const WEAK_TO: Record<string, string> = {
  Normal: 'Dark',
  Fire: 'Water',
  Water: 'Electricity',
  Electricity: 'Earth',
  Leaf: 'Fire',
  Earth: 'Leaf',
  Ice: 'Fire',
  Dragon: 'Ice',
  Dark: 'Dragon',
}

// badge colors behind the white in-game glyphs, themed per work type
export const WORK_COLORS: Record<string, string> = {
  Kindling: '#d95b3c',
  Watering: '#3f8fd4',
  Planting: '#5aa348',
  'Generating Electricity': '#d9b13c',
  Handiwork: '#c98a4e',
  Gathering: '#7fb542',
  Lumbering: '#8a6d4e',
  Mining: '#8c8c94',
  'Oil Extracting': '#6b5b73',
  'Medicine Production': '#5bb8a5',
  Cooling: '#5bc0d4',
  Transporting: '#a3865e',
  Farming: '#b06fb0',
}

export const WORK_ICONS: Record<string, string> = {
  Kindling: '🔥',
  Watering: '💧',
  Planting: '🌱',
  'Generating Electricity': '⚡',
  Handiwork: '✋',
  Gathering: '🧺',
  Lumbering: '🪓',
  Mining: '⛏️',
  'Oil Extracting': '🛢️',
  'Medicine Production': '💊',
  Cooling: '❄️',
  Transporting: '📦',
  Farming: '🐄',
}
