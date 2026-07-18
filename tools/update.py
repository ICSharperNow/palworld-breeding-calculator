#!/usr/bin/env python3
"""One-command data updater for the Palworld breeding calculator.

    python3 tools/update.py            # detect game version, regenerate only if it changed
    python3 tools/update.py --force    # regenerate regardless
    python3 tools/update.py --game-dir "D:/SteamLibrary/steamapps/common/Palworld"

Detects the installed Palworld version (Steam buildid, falling back to a
pak fingerprint), and when it differs from data/version.json runs the full
pipeline: repak extract -> CUE4Parse export -> transform -> web build ->
single-file HTML. Downloads repak and the community Mappings.usmap by
itself; the only external requirements are the .NET 10 SDK, Node.js, and
Python 3.

The chosen game directory is remembered in tools/.gamepath.
"""
import argparse
import glob
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
BIN = TOOLS / "bin"
VERSION_FILE = ROOT / "data" / "version.json"
GAMEPATH_FILE = TOOLS / ".gamepath"
APP_ID = "1623730"  # Palworld on Steam

USMAP_URL = "https://github.com/PalworldModding/UsefulFiles/raw/master/Mappings.usmap"
REPAK_BASE = "https://github.com/trumank/repak/releases/latest/download"

PAK_INCLUDES = [
    "Pal/Content/Pal/DataTable/Character",
    "Pal/Content/Pal/DataTable/PassiveSkill",
    "Pal/Content/L10N/en/Pal/DataTable/Text",
    "Pal/Content/Pal/Texture/PalIcon/Normal",
    "Pal/Content/Pal/DataTable/UI",
    "Pal/Content/Pal/DataTable/WorldMapUIData",
    "Pal/Content/Pal/Texture/UI/Map",
    "Pal/Content/Pal/Texture/UI/InGame/SkillIcon",
    "Pal/Content/Pal/Texture/UI/IngameMenu/Research/EffectIcon",
]


def log(msg):
    print(f"[update] {msg}", flush=True)


def die(msg):
    print(f"[update] ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------- game install
def candidate_dirs():
    yield from (
        Path(p) / "steamapps" / "common" / "Palworld"
        for p in [
            "C:/Program Files (x86)/Steam",
            "C:/Program Files/Steam",
            "/mnt/c/Program Files (x86)/Steam",
            "/mnt/c/Program Files/Steam",
            Path.home() / ".steam" / "steam",
            Path.home() / ".local" / "share" / "Steam",
        ]
    )
    # secondary Steam libraries on any drive
    for pat in ["[A-Z]:/SteamLibrary", "/mnt/*/SteamLibrary", "/mnt/*/Steam"]:
        for lib in glob.glob(str(pat)):
            yield Path(lib) / "steamapps" / "common" / "Palworld"


def find_game(cli_dir):
    if cli_dir:
        d = Path(cli_dir)
        if not (d / "Pal" / "Content" / "Paks" / "Pal-Windows.pak").is_file():
            die(f"no Pal-Windows.pak under {d}")
        GAMEPATH_FILE.write_text(str(d))
        return d
    if GAMEPATH_FILE.is_file():
        d = Path(GAMEPATH_FILE.read_text().strip())
        if (d / "Pal" / "Content" / "Paks" / "Pal-Windows.pak").is_file():
            return d
        log(f"saved game path {d} no longer valid, re-detecting")
    for d in candidate_dirs():
        if (d / "Pal" / "Content" / "Paks" / "Pal-Windows.pak").is_file():
            log(f"found Palworld at {d}")
            GAMEPATH_FILE.write_text(str(d))
            return d
    die("Palworld install not found - pass --game-dir \"<path to .../steamapps/common/Palworld>\"")


def game_version(game_dir: Path):
    """Steam buildid if available, else a pak size+mtime fingerprint."""
    pak = game_dir / "Pal" / "Content" / "Paks" / "Pal-Windows.pak"
    manifest = game_dir.parent.parent / f"appmanifest_{APP_ID}.acf"
    if manifest.is_file():
        m = re.search(r'"buildid"\s+"(\d+)"', manifest.read_text(errors="ignore"))
        if m:
            return {"buildid": m.group(1), "pakSize": pak.stat().st_size}
    st = pak.stat()
    return {"pakSize": st.st_size, "pakMtime": int(st.st_mtime)}


# ------------------------------------------------------------------- toolchain
def fetch(url, dest: Path):
    log(f"downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)


def ensure_repak():
    exe = BIN / ("repak.exe" if os.name == "nt" else "repak")
    if exe.is_file():
        return exe
    BIN.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        if os.name == "nt":
            archive = td / "repak.zip"
            fetch(f"{REPAK_BASE}/repak_cli-x86_64-pc-windows-msvc.zip", archive)
            with zipfile.ZipFile(archive) as z:
                z.extractall(td)
        else:
            if platform.machine() not in ("x86_64", "AMD64"):
                die("no prebuilt repak for this architecture - install repak yourself and put it in tools/bin/")
            archive = td / "repak.tar.xz"
            fetch(f"{REPAK_BASE}/repak_cli-x86_64-unknown-linux-gnu.tar.xz", archive)
            with tarfile.open(archive) as t:
                t.extractall(td)
        found = next(td.rglob("repak.exe" if os.name == "nt" else "repak"), None)
        if not found:
            die("repak binary missing from downloaded archive")
        shutil.copy2(found, exe)
    exe.chmod(0o755)
    return exe


def require(cmd, hint):
    if shutil.which(cmd) is None:
        die(f"'{cmd}' not found - {hint}")


def run(args, **kw):
    log(" ".join(str(a) for a in args))
    subprocess.run([str(a) for a in args], check=True, **kw)


# -------------------------------------------------------------------- pipeline
def regenerate(game_dir: Path):
    require("dotnet", "install the .NET 10 SDK: https://dotnet.microsoft.com/download")
    require("npm", "install Node.js: https://nodejs.org")
    repak = ensure_repak()
    pak = game_dir / "Pal" / "Content" / "Paks" / "Pal-Windows.pak"

    usmap = TOOLS / "Mappings.usmap"
    fetch(USMAP_URL, usmap)  # small; always refresh so it matches the new patch

    with tempfile.TemporaryDirectory(prefix="palworld-extract-") as td:
        extracted = Path(td) / "extracted"
        cmd = [repak, "unpack", "-o", extracted, "-f"]
        for inc in PAK_INCLUDES:
            cmd += ["-i", inc]
        cmd.append(pak)
        run(cmd)
        run(["dotnet", "run", "--project", TOOLS / "exporter", "--",
             extracted, usmap, ROOT / "data" / "raw"])

    run([sys.executable, TOOLS / "transform.py", ROOT / "data" / "raw", ROOT / "web" / "src" / "data"])

    web = ROOT / "web"
    if not (web / "node_modules").is_dir():
        run(["npm", "install"], cwd=web)
    run(["npm", "run", "build"], cwd=web)
    shutil.copy2(web / "dist" / "index.html", ROOT / "Palworld Breeding Calculator.html")


def main():
    ap = argparse.ArgumentParser(description="Regenerate calculator data when the game updates")
    ap.add_argument("--force", action="store_true", help="regenerate even if the version is unchanged")
    ap.add_argument("--game-dir", help="path to .../steamapps/common/Palworld")
    ap.add_argument("--check", action="store_true", help="only report whether an update is needed")
    args = ap.parse_args()

    game_dir = find_game(args.game_dir)
    current = game_version(game_dir)
    stored = json.loads(VERSION_FILE.read_text()) if VERSION_FILE.is_file() else None

    if stored == current and not args.force:
        log(f"game unchanged ({stored.get('buildid', 'pak fingerprint match')}) - nothing to do")
        return
    if args.check:
        log(f"update needed: stored={stored} current={current}")
        sys.exit(2)

    log(f"game version changed: {stored} -> {current}" if stored else "no stored version - full generation")
    regenerate(game_dir)
    VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    VERSION_FILE.write_text(json.dumps(current, indent=1))
    log("done - data, web build, and single-file HTML are up to date")


if __name__ == "__main__":
    main()
