# 🥚 Palworld 1.0 Breeding Calculator

A fast, single-file breeding calculator and pal toolbox for **Palworld 1.0**, with every
number pulled **directly from the game files** - not from stale community spreadsheets.
When Pocketpair ships a patch, one command detects it and re-extracts everything.

**291 pals · 185 unique combos · 86 passives · full spawn maps · in-game icons**

![Breed tab](docs/screenshots/ss-breed.png)

## ✨ No install - just open it

Download **[`Palworld Breeding Calculator.html`](Palworld%20Breeding%20Calculator.html)**
and double-click it. That's the whole app: every pal, icon, map, and formula is bundled
into one portable HTML file (~2 MB). Works offline, no server, no tracking.

## The tools

### 🥚 Breed
Pick two parents and see the exact child as a visual equation, including the gendered
unique combos (Katress × Wixen works both ways). Swap button included.

### 🎯 Find Parents
Pick a target pal and get every parent pair that produces it - Anubis has 69. Sort by
Paldeck number, name, common-parents-first, rarest-first, or element; filter by parent
name or element chips.

![Find Parents](docs/screenshots/ss-parents.png)

### 🗺️ Path Finder
Shortest breeding chain to a goal pal, two ways:

- **From one pal** (paldb-style): any partner allowed, wild catches assumed. Each step
  shows the partner to use plus how many alternatives would work.
- **Only pals I own**: restricted to your box, with alternative final pairings.

Tag up to 4 passives to carry through the chain and get per-egg keep odds, whole-chain
first-try probability, and expected total eggs.

### 🧬 Plan Builder
The multi-pal planner: enter several pals and the passives on each, plus an optional
goal species. It builds a full step-by-step plan that merges every tracked passive onto
one bloodline (cheapest merges first) and walks it to the goal, with per-egg odds,
whole-plan first-try probability, and expected egg count.

![Plan Builder](docs/screenshots/plan1.png)

### ✨ Passive Odds
Mark the passives the two parents have between them and the ones you want on the child -
get the probability of inheriting at least the desired set, the exact set, and the
expected number of eggs (40/30/20/10 inheritance model).

### 📜 Passive Skills
Every passive a pal can have, with real in-game descriptions, tier badges (−1 to +4),
search, and tier/name sorting. Click any skill for details: effect breakdown, wild roll
chance from the game's lottery weights, and rare-only sourcing.

![Passive Skills](docs/screenshots/ss-passives.png)

### 🌍 Spawn Map
Where every pal spawns, from the game's own Paldeck distribution data (~150k spawn
points). Pick any of the 259 spawnable pals from the searchable list:

- Day / night areas in customizable highlight colors (overlap auto-blends)
- Glowing attention rings around every spawn cluster - tiny habitats are unmissable
- Scroll-wheel zoom anchored at the cursor, drag panning, fullscreen
- Live in-game coordinates under the crosshair + spawn-center coordinates
- Separate **World Tree** map for the 41 pals that spawn there (World-Tree-only pals
  are flagged 🌳)

![Spawn Map](docs/screenshots/ss-map.png)

### 📖 Paldeck
Browse all 291 pals with rarity-colored frames. Sort by number, name, rarity, element,
or breeding power; filter by element.

### Everything is clickable
Any pal shown anywhere - result cards, parent pairs, path steps, deck cells - opens a
detail popup: stats, gender ratio, rarity, breeding power, unique combos, its own spawn
map, and shortcut buttons into Find Parents and Path Finder. Details stack with a Back
button, and closing returns you exactly where you were.

## How breeding works in 1.0 (as datamined)

- Same species always breeds true.
- The 258-row `DT_PalCombiUnique` table overrides everything - including self×self locks
  for legendaries and two gender-specific combos (Katress × Wixen, both directions).
- Otherwise: child rank = `floor((rankA + rankB + 1) / 2)`, and the child is the breedable
  pal (`IgnoreCombi = false`) with the closest `CombiRank`; ties break by lower
  `CombiDuplicatePriority`, then table order.
- Passive odds use the community-datamined model: the child rolls 1-4 passives from the
  parents' combined pool at 40/30/20/10%. Random mutations aren't modeled.

## Run from source

```sh
cd web
npm install
npm run dev        # dev server
npm run build      # production build → dist/index.html (fully self-contained)
```

React + Vite + TypeScript, zero runtime dependencies beyond React. The single-file build
comes from `vite-plugin-singlefile` with all assets inlined - copy `dist/index.html`
wherever you like.

## Updating after a game patch - automatic

One command. It finds your Palworld install (Steam library auto-detection, Windows and
WSL), reads the installed version (Steam buildid), and regenerates everything only when
the game actually changed:

```sh
python3 tools/update.py
```

- Game unchanged → prints `game unchanged - nothing to do` and exits.
- Game updated → downloads [repak](https://github.com/trumank/repak) and the current
  community [`Mappings.usmap`](https://github.com/PalworldModding/UsefulFiles)
  automatically, extracts the DataTables, icons, and map textures from the pak, exports
  and transforms the data, rebuilds the web app, and refreshes
  `Palworld Breeding Calculator.html`.

Requirements: Python 3, [.NET 10 SDK](https://dotnet.microsoft.com/download), Node.js.

Useful flags:

```sh
python3 tools/update.py --check                 # just report whether an update is needed
python3 tools/update.py --force                 # regenerate even if unchanged
python3 tools/update.py --game-dir "D:/SteamLibrary/steamapps/common/Palworld"
```

The detected game path is remembered in `tools/.gamepath`; the installed version stamp
lives in `data/version.json`. The repo ships with freshly extracted 1.0 data already in
place, so you only run this after a patch.

<details>
<summary><b>Manual pipeline</b> (what update.py does under the hood)</summary>

```sh
# 1. extract DataTables + icons + map textures
repak unpack -o extracted \
  -i "Pal/Content/Pal/DataTable/Character" \
  -i "Pal/Content/Pal/DataTable/PassiveSkill" \
  -i "Pal/Content/L10N/en/Pal/DataTable/Text" \
  -i "Pal/Content/Pal/Texture/PalIcon/Normal" \
  -i "Pal/Content/Pal/DataTable/UI" \
  -i "Pal/Content/Pal/DataTable/WorldMapUIData" \
  -i "Pal/Content/Pal/Texture/UI/Map" \
  "<Palworld install>/Pal/Content/Paks/Pal-Windows.pak"

# 2. export to JSON + decode icons and maps (needs Mappings.usmap)
dotnet run --project tools/exporter -- extracted Mappings.usmap data/raw

# 3. transform into the app dataset
python3 tools/transform.py data/raw web/src/data

# 4. rebuild
cd web && npm install && npm run build
cp dist/index.html "../Palworld Breeding Calculator.html"
```

</details>

## Repository layout

```
Palworld Breeding Calculator.html   ← the app, ready to open
web/                                ← React + Vite source
  src/lib/breeding.ts               ← breeding formula, path finder, bloodline planner
  src/lib/passives.ts               ← passive inheritance math
  src/lib/spawns.ts                 ← spawn map decoding + coordinate transforms
  src/data/                         ← generated dataset (pals, combos, passives, icons,
                                       spawn maps, world + World Tree map textures)
tools/
  update.py                         ← auto-detects game patches, regenerates everything
  exporter/                         ← C# CUE4Parse DataTable + texture exporter
  transform.py                      ← raw JSON → app dataset
data/raw/                           ← DataTable JSON exports from the 1.0 pak
data/version.json                   ← installed game version stamp (patch detection)
```

## Disclaimer

Palworld and all pal names, icons, and game data are © Pocketpair, Inc. This is an
unofficial fan-made tool for personal use, not affiliated with or endorsed by Pocketpair.
Game data is extracted locally from your own legally owned copy.

Code is MIT-licensed - see [LICENSE](LICENSE).
