#!/usr/bin/env python3
"""Transform CUE4Parse DataTable JSON exports into the calculator dataset.

Inputs (from CUE4Parse export of Pal-Windows.pak):
  DT_PalMonsterParameter.json  - per-character params (CombiRank etc.)
  DT_PalCombiUnique.json       - unique breeding combos
  DT_PassiveSkill_Main.json    - passive skills
  DT_PalNameText_Common.json   - EN pal names
  DT_SkillNameText_Common.json - EN skill names (incl. passives)
  DT_SkillDescText_Common.json - EN skill descriptions

Outputs: web/src/data/{pals.json,combos.json,passives.json}
"""
import json
import re
import sys
from pathlib import Path

RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "data" / "raw"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).parent.parent / "web" / "src" / "data"
OUT.mkdir(parents=True, exist_ok=True)


def rows(name):
    return json.load(open(RAW / f"{name}.json"))["Rows"]


def enum_val(s):
    return s.split("::")[-1] if isinstance(s, str) else s


monster = rows("DT_PalMonsterParameter")
combi = rows("DT_PalCombiUnique")
passive = rows("DT_PassiveSkill_Main")
pal_names = rows("DT_PalNameText_Common")
skill_names = rows("DT_SkillNameText_Common")
skill_descs = rows("DT_SkillDescText_Common")

# --- names (case-insensitive join: row key "WindChimes" vs text key "Windchimes") ---
names_ci = {}
for k, v in pal_names.items():
    if k.startswith("PAL_NAME_"):
        names_ci[k[len("PAL_NAME_"):].lower()] = v["TextData"]["LocalizedString"]

EXCLUDE_KEY = re.compile(r"(^|_)(BOSS|Boss|SUMMON|RAID|PREDATOR|GYM|Quest|NPC)(_|$)|_Oilrig", re.I)


def display_name(key):
    n = names_ci.get(key.lower())
    if n:
        return n
    # fallback: variant without its own text entry, e.g. PlantSlime_Flower
    base = key.split("_")[0]
    b = names_ci.get(base.lower())
    return f"{b} (Special)" if b else None


WORK_LABELS = {
    "WorkSuitability_EmitFlame": "Kindling",
    "WorkSuitability_Watering": "Watering",
    "WorkSuitability_Seeding": "Planting",
    "WorkSuitability_GenerateElectricity": "Generating Electricity",
    "WorkSuitability_Handcraft": "Handiwork",
    "WorkSuitability_Collection": "Gathering",
    "WorkSuitability_Deforest": "Lumbering",
    "WorkSuitability_Mining": "Mining",
    "WorkSuitability_OilExtraction": "Oil Extracting",
    "WorkSuitability_ProductMedicine": "Medicine Production",
    "WorkSuitability_Cool": "Cooling",
    "WorkSuitability_Transport": "Transporting",
    "WorkSuitability_MonsterFarm": "Farming",
}

pals = []
for key, r in monster.items():
    if r.get("ZukanIndex", 0) <= 0 or EXCLUDE_KEY.search(key):
        continue
    name = display_name(key)
    if not name:
        continue  # unreleased/dummy rows without any EN name
    pals.append({
        "id": key,
        "name": name,
        "zukan": r["ZukanIndex"],
        "suffix": r.get("ZukanIndexSuffix", "") or "",
        "rank": r["CombiRank"],
        "prio": r["CombiDuplicatePriority"],
        "ignoreCombi": bool(r.get("IgnoreCombi")),
        "maleProb": r.get("MaleProbability", 50),
        "elements": [e for e in (enum_val(r.get("ElementType1")), enum_val(r.get("ElementType2")))
                     if e and e != "None"],
        "rarity": r.get("Rarity", 1),
        "stats": {
            "hp": r.get("Hp", 0),
            "atk": r.get("ShotAttack", 0),
            "def": r.get("Defense", 0),
            "workSpeed": r.get("CraftSpeed", 0),
            "stamina": r.get("Stamina", 0),
            "food": r.get("FoodAmount", 0),
            "run": r.get("RunSpeed", 0),
            "ride": r.get("RideSprintSpeed", 0),
        },
        "nocturnal": bool(r.get("Nocturnal")),
        "work": {WORK_LABELS[k]: r[k] for k in WORK_LABELS if r.get(k, 0) > 0},
    })
pals.sort(key=lambda p: (p["zukan"], p["suffix"]))

pal_ids_ci = {p["id"].lower(): p["id"] for p in pals}

# --- unique combos (tribe refs are case-sloppy: "Blueplatypus") ---
combos = []
skipped = []
for k, v in combi.items():
    a = pal_ids_ci.get(enum_val(v["ParentTribeA"]).lower())
    b = pal_ids_ci.get(enum_val(v["ParentTribeB"]).lower())
    child = pal_ids_ci.get(v["ChildCharacterID"].lower())
    if not (a and b and child):
        skipped.append((k, v["ChildCharacterID"]))
        continue
    ga = enum_val(v["ParentGenderA"])
    gb = enum_val(v["ParentGenderB"])
    combos.append({
        "a": a, "aG": ga if ga != "None" else None,
        "b": b, "bG": gb if gb != "None" else None,
        "child": child,
    })

# --- passives obtainable on pals ---
EFFECT_LABELS = {
    "ShotAttack": "Attack",
    "CraftSpeed": "Work Speed",
    "Defense": "Defense",
    "MaxHP": "Max HP",
    "MoveSpeed": "Movement Speed",
    "SwimSpeed": "Swim Speed",
    "AutoHPRegeneRate": "HP regeneration",
    "ReloadSpeedUp": "Reload speed",
    "PlayerSP_DecreaseRate": "Player stamina drain",
    "SelfDeathAddItemDrop": "Item drops on defeat",
    "WorkSuitabilityAddRank_MonsterFarm": "Ranch work suitability",
    "LeanBackInvalid_ForPassiveSkill": "Immune to Flinch",
    "KnockbackInvalid_ForPassiveSkill": "Immune to Knockback",
    "SanityDecreaseRate": "Sanity drain",
    "HungerDecreaseRate": "Hunger drain",
    "GainStatusPointRate": "Stat points gained",
    "CraftSpeedBySanity": "Work Speed (by sanity)",
    "MaxSP": "Max stamina",
}


def passive_desc(key, r):
    ds = skill_descs.get(f"PASSIVE_{key}") or skill_descs.get(f"PASSIVE_{key}_DESC")
    if ds:
        text = ds["TextData"]["LocalizedString"]
        for i in (1, 2, 3, 4):
            v = r.get(f"EffectValue{i}", 0)
            text = text.replace(f"{{EffectValue{i}}}", f"{v:g}")
        return re.sub(r"<[^>]*>", "", text).strip()
    # no localized text: synthesize from the effect data
    parts = []
    for i in (1, 2, 3, 4):
        t = (r.get(f"EffectType{i}") or "").split("::")[-1]
        if t in ("no", "None", ""):
            continue
        v = r.get(f"EffectValue{i}", 0)
        label = EFFECT_LABELS.get(t, t)
        if t == "WorkSuitabilityAddRank_MonsterFarm":
            parts.append(f"{label} {v:+g}")
        else:
            parts.append(f"{label} {v:+g}%")
    return " · ".join(parts)


passives = []
for key, r in passive.items():
    lottery = r.get("AddPal") or r.get("AddRarePal")
    # innate / special-source passives (Legend, the element Emperor set, World
    # Tree passives, mutation pals...) never enter the wild lottery but are
    # real pal passives: displayable category + a localized name
    displayable = str(r.get("Category", "")).endswith("SortDisplayable") and f"PASSIVE_{key}" in skill_names
    if not (lottery or displayable):
        continue
    nm = skill_names.get(f"PASSIVE_{key}")
    effects = []
    for i in (1, 2, 3, 4):
        t = (r.get(f"EffectType{i}") or "").split("::")[-1]
        if t in ("no", "None", ""):
            continue
        effects.append({"t": EFFECT_LABELS.get(t, t), "v": r.get(f"EffectValue{i}", 0)})
    passives.append({
        "id": key,
        "name": nm["TextData"]["LocalizedString"] if nm else key,
        "desc": passive_desc(key, r),
        "rank": r.get("Rank", 0),
        "effects": effects,
        "weight": r.get("LotteryWeight", 0) if lottery else 0,
        "rareOnly": bool(r.get("AddRarePal")) and not r.get("AddPal"),
        "special": not lottery,
    })
passives.sort(key=lambda p: (-p["rank"], p["name"]))

# --- spawn locations: quantized day/night habitat points from the game's own
# Paldeck distribution table, plus the world-map bounds that position them ---
SPAWN_GRID = 320
# World-to-T_WorldMap bounds, calibrated by fitting the full spawn point cloud
# onto the map texture's landmass (maximizing points-on-land F-score). The
# DT_WorldMapUIData landscape bounds only cover the original continent; these
# extend to the whole 1.0 world texture (Sakurajima, Feybreak, oil rigs).
MAP_MIN_X, MAP_MAX_X = -1105255.0, 355765.0   # world X: south edge .. north edge
MAP_MIN_Y, MAP_MAX_Y = -730039.0, 730981.0    # world Y: west edge .. east edge
try:
    dist = rows("DT_PaldexDistributionData")
    wm_tree = rows("DT_WorldMapUIData")["Tree"]
    t_mn, t_mx = wm_tree["landScapeRealPositionMin"], wm_tree["landScapeRealPositionMax"]
    TREE = (t_mn["X"], t_mx["X"], t_mn["Y"], t_mx["Y"])
    MAIN = (MAP_MIN_X, MAP_MAX_X, MAP_MIN_Y, MAP_MAX_Y)

    def cell(loc, bounds):
        min_x, max_x, min_y, max_y = bounds
        if not (min_x <= loc["X"] <= max_x and min_y <= loc["Y"] <= max_y):
            return None
        u = int((loc["Y"] - min_y) / (max_y - min_y) * (SPAWN_GRID - 1))
        v = int((1 - (loc["X"] - min_x) / (max_x - min_x)) * (SPAWN_GRID - 1))
        return v * SPAWN_GRID + u

    def delta(pts):
        srt = sorted(pts)
        return [srt[0]] + [b - a for a, b in zip(srt, srt[1:])]

    spawns = {}
    stray = 0
    for key, r in dist.items():
        pal_id = pal_ids_ci.get(key.lower())
        if not pal_id:
            continue
        entry = {}
        # short keys: d/n = main map day/night, td/tn = World Tree day/night
        for grp, main_key, tree_key in (("dayTimeLocations", "d", "td"),
                                        ("nightTimeLocations", "n", "tn")):
            main_pts, tree_pts = set(), set()
            for loc in (r.get(grp) or {}).get("Locations", []):
                c = cell(loc, MAIN)
                if c is not None:
                    main_pts.add(c)
                    continue
                c = cell(loc, TREE)
                if c is not None:
                    tree_pts.add(c)
                else:
                    stray += 1
            if main_pts:
                entry[main_key] = delta(main_pts)
            if tree_pts:
                entry[tree_key] = delta(tree_pts)
        if entry:
            spawns[pal_id] = entry
    json.dump({"grid": SPAWN_GRID,
               "bounds": {"main": MAIN, "tree": TREE},
               "pals": spawns},
              open(OUT / "spawns.json", "w"), separators=(",", ":"))
    import shutil
    shutil.copyfile(RAW / "worldmap.webp", OUT / "worldmap.webp")
    shutil.copyfile(RAW / "treemap.webp", OUT / "treemap.webp")
    tree_pals = sum(1 for v in spawns.values() if "td" in v or "tn" in v)
    print(f"spawns: {len(spawns)} pals ({tree_pals} in World Tree, {stray} stray points)")
except FileNotFoundError as e:
    print(f"spawn data skipped ({e})")

# --- world (field) bosses: FieldBoss spawner placements joined to their pal ---
try:
    placement = rows("DT_PalSpawnerPlacement")
    wild = rows("DT_PalWildSpawner")
    boss_by_name = {}
    for w in wild.values():
        if not str(w.get("SpawnerType", "")).endswith("FieldBoss"):
            continue
        pal_ref = w.get("Pal_1", "")
        if pal_ref in ("RowName", "None", ""):
            continue  # junk rows
        boss_by_name.setdefault(w["SpawnerName"], w)

    def norm(X, Y, bounds):
        min_x, max_x, min_y, max_y = bounds
        u = (Y - min_y) / (max_y - min_y)
        v = 1 - (X - min_x) / (max_x - min_x)
        return round(u, 4), round(v, 4)

    bosses = []
    for v in placement.values():
        if not str(v.get("SpawnerType", "")).endswith("FieldBoss"):
            continue
        w = boss_by_name.get(v["SpawnerName"])
        if not w:
            continue
        base = w["Pal_1"]
        for pre in ("BOSS_", "Boss_", "boss_"):
            if base.startswith(pre):
                base = base[len(pre):]
        pal_id = pal_ids_ci.get(base.lower())
        if not pal_id:
            continue
        X, Y = v["Location"]["X"], v["Location"]["Y"]
        if MAP_MIN_X <= X <= MAP_MAX_X and MAP_MIN_Y <= Y <= MAP_MAX_Y:
            m, (u, vv) = "main", norm(X, Y, (MAP_MIN_X, MAP_MAX_X, MAP_MIN_Y, MAP_MAX_Y))
        elif TREE[0] <= X <= TREE[1] and TREE[2] <= Y <= TREE[3]:
            m, (u, vv) = "tree", norm(X, Y, TREE)
        else:
            continue
        bosses.append({
            # stable across regenerations: spawner name + rounded world coords
            "id": f"{v['SpawnerName']}@{round(X)},{round(Y)}",
            "pal": pal_id,
            "lv": w.get("LvMin_1", 0),
            "m": m,
            "u": u,
            "v": vv,
        })
    json.dump(bosses, open(OUT / "bosses.json", "w"), separators=(",", ":"))
    print(f"world bosses: {len(bosses)} "
          f"({sum(1 for b in bosses if b['m'] == 'tree')} in World Tree)")
except FileNotFoundError as e:
    print(f"boss data skipped ({e})")

# --- icons: embed as data URIs so the single-file build stays portable ---
import base64

icon_dir = RAW / "icons"
icon_files = {f.stem.lower(): f for f in icon_dir.glob("*.webp")} if icon_dir.is_dir() else {}


def icon_for(pal_id):
    # exact match, then progressively strip trailing _segments (variant fallback)
    parts = pal_id.split("_")
    while parts:
        f = icon_files.get("_".join(parts).lower())
        if f:
            return "data:image/webp;base64," + base64.b64encode(f.read_bytes()).decode()
        parts.pop()
    return None


icons = {}
for p in pals:
    uri = icon_for(p["id"])
    if uri:
        icons[p["id"]] = uri
json.dump(icons, open(OUT / "icons.json", "w"))
print(f"icons embedded: {len(icons)}/{len(pals)}")

# --- work suitability icons (in-game textures) keyed by display label ---
WORK_ICON_FILES = {
    "Kindling": "EmitFlame",
    "Watering": "Watering",
    "Planting": "Seeding",
    "Generating Electricity": "GenerateElectricity",
    "Handiwork": "Handcraft",
    "Gathering": "Collection",
    "Lumbering": "Deforest",
    "Mining": "Mining",
    "Oil Extracting": "OilExtraction",
    "Medicine Production": "ProductMedicine",
    "Cooling": "Cool",
    "Transporting": "Transport",
    "Farming": "MonsterFarm",
}
wi_dir = RAW / "workicons"
if wi_dir.is_dir():
    import base64 as _b64
    work_icons = {}
    for label, fname in WORK_ICON_FILES.items():
        f = wi_dir / f"{fname}.webp"
        if f.is_file():
            work_icons[label] = "data:image/webp;base64," + _b64.b64encode(f.read_bytes()).decode()
    json.dump(work_icons, open(OUT / "workicons.json", "w"))
    print(f"work icons: {len(work_icons)}/13")

json.dump(pals, open(OUT / "pals.json", "w"), indent=1)
json.dump(combos, open(OUT / "combos.json", "w"), indent=1)
json.dump(passives, open(OUT / "passives.json", "w"), indent=1)

print(f"pals: {len(pals)}  (rank candidates: {sum(1 for p in pals if not p['ignoreCombi'])})")
print(f"unique combos: {len(combos)}  skipped: {len(skipped)} {skipped[:5]}")
print(f"passives: {len(passives)}")
same_tribe = [c for c in combos if c["a"] == c["b"]]
print(f"same-tribe unique combos: {len(same_tribe)} {same_tribe[:3]}")
