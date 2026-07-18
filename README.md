# 🥚 Palworld 1.0 Breeding Calculator

A fast, single-file breeding calculator for **Palworld 1.0**, with every number pulled
**directly from the game files** — not from stale community spreadsheets. When Pocketpair
ships a patch, one command re-extracts everything.

**291 pals · 185 unique combos · real 1.0 breeding powers · in-game icons**

![Breed tab](docs/screenshots/ss-breed.png)

## ✨ No install — just open it

Download **[`Palworld Breeding Calculator.html`](Palworld%20Breeding%20Calculator.html)**
and double-click it. That's the whole app: every pal, icon, and formula is bundled into one
portable HTML file (~1.4 MB). Works offline, no server, no tracking.

## What it does

| Tab | What you get |
|---|---|
| 🥚 **Breed** | Pick two parents → see the exact child, as a visual equation |
| 🎯 **Find Parents** | Pick a target → every parent pair that produces it, sortable by rarity/element/name |
| 🗺️ **Path Finder** | Shortest breeding chain to a goal pal — from one pal (paldb-style, wild partners allowed) or restricted to pals you own — with passive carry-through odds |
| 🧬 **Plan Builder** | Enter several pals + the passives on each → a full step-by-step plan that merges everything onto one bloodline and ends at your goal species, with per-egg odds and expected egg counts |
| ✨ **Passive Odds** | Inheritance probability for any desired passive set |
| 📖 **Paldeck** | Browse all 291 pals — sort by number, name, rarity, element, breeding power; filter by element |

Every pal shown anywhere is **clickable** — a detail popup shows its stats, unique combos,
and shortcuts into the other tools, with back/close returning you exactly where you were.

![Find Parents](docs/screenshots/ss-parents.png)
![Plan Builder](docs/screenshots/plan1.png)
![Paldeck](docs/screenshots/ss-paldeck.png)

## How breeding works in 1.0 (as datamined)

- Same species always breeds true.
- The 258-row `DT_PalCombiUnique` table overrides everything — including self×self locks
  for legendaries and two gender-specific combos (Katress × Wixen, both directions).
- Otherwise: child rank = `floor((rankA + rankB + 1) / 2)`, and the child is the breedable
  pal (`IgnoreCombi = false`) with the closest `CombiRank`; ties break by lower
  `CombiDuplicatePriority`, then table order.
- Passive odds use the community-datamined model: the child rolls 1–4 passives from the
  parents' combined pool at 40/30/20/10%. Random mutations aren't modeled.

## Run from source

```sh
cd web
npm install
npm run dev        # dev server
npm run build      # production build → dist/index.html (fully self-contained)
```

The app is React + Vite + TypeScript with zero runtime dependencies beyond React. The
single-file build comes from `vite-plugin-singlefile` — copy `dist/index.html` wherever
you like.

## Regenerate the data after a game patch

Everything in `web/src/data/` is generated from your installed game. To refresh:

**1. Extract the DataTables and icons** with [repak](https://github.com/trumank/repak):

```sh
repak unpack -o extracted \
  -i "Pal/Content/Pal/DataTable/Character" \
  -i "Pal/Content/Pal/DataTable/PassiveSkill" \
  -i "Pal/Content/L10N/en/Pal/DataTable/Text" \
  -i "Pal/Content/Pal/Texture/PalIcon/Normal" \
  "<Palworld install>/Pal/Content/Paks/Pal-Windows.pak"
```

**2. Export to JSON + decode icons** (`tools/exporter`, needs the [.NET 10 SDK](https://dotnet.microsoft.com/download)
and a current `Mappings.usmap` from [PalworldModding/UsefulFiles](https://github.com/PalworldModding/UsefulFiles)):

```sh
dotnet run --project tools/exporter -- extracted Mappings.usmap data/raw
```

**3. Transform into the app dataset** (Python 3, stdlib only):

```sh
python3 tools/transform.py data/raw web/src/data
```

**4. Rebuild:**

```sh
cd web && npm install && npm run build
cp dist/index.html "../Palworld Breeding Calculator.html"
```

The repo ships with freshly extracted 1.0 data (`data/raw/`) already in place, so steps 1–3
are only needed after a patch.

## Repository layout

```
Palworld Breeding Calculator.html   ← the app, ready to open
web/                                ← React + Vite source
  src/lib/breeding.ts               ← breeding formula, path finder, bloodline planner
  src/lib/passives.ts               ← passive inheritance math
  src/data/                         ← generated dataset (pals, combos, passives, icons)
tools/
  exporter/                         ← C# CUE4Parse DataTable + icon exporter
  transform.py                      ← raw JSON → app dataset
data/raw/                           ← DataTable JSON exports from the 1.0 pak
```

## Disclaimer

Palworld and all pal names, icons, and game data are © Pocketpair, Inc. This is an
unofficial fan-made tool for personal use, not affiliated with or endorsed by Pocketpair.
Game data is extracted locally from your own legally owned copy.

Code is MIT-licensed — see [LICENSE](LICENSE).
