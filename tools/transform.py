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
passives = []
for key, r in passive.items():
    if not (r.get("AddPal") or r.get("AddRarePal")):
        continue
    nm = skill_names.get(f"PASSIVE_{key}")
    ds = skill_descs.get(f"PASSIVE_{key}")
    passives.append({
        "id": key,
        "name": nm["TextData"]["LocalizedString"] if nm else key,
        "desc": ds["TextData"]["LocalizedString"] if ds else "",
        "rank": r.get("Rank", 0),
    })
passives.sort(key=lambda p: (-p["rank"], p["name"]))

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

json.dump(pals, open(OUT / "pals.json", "w"), indent=1)
json.dump(combos, open(OUT / "combos.json", "w"), indent=1)
json.dump(passives, open(OUT / "passives.json", "w"), indent=1)

print(f"pals: {len(pals)}  (rank candidates: {sum(1 for p in pals if not p['ignoreCombi'])})")
print(f"unique combos: {len(combos)}  skipped: {len(skipped)} {skipped[:5]}")
print(f"passives: {len(passives)}")
same_tribe = [c for c in combos if c["a"] == c["b"]]
print(f"same-tribe unique combos: {len(same_tribe)} {same_tribe[:3]}")
