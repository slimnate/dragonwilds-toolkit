"""Build data/skills.json from extracted SKILL_* assets and copy UI icons.

Expects:
  exports/legacy_skills/**/SKILL_*.uasset + .uexp  (retoc to-legacy --filter SKILL_)
  exports/raw_skills/**/SKILL_*.json               (UAssetGUI tojson)
  exports/icons/**/*.png                          (UnrealExporter icon dump)

Writes data/skills.json and copies chosen PNGs into data/skills/.
"""

from __future__ import annotations

import argparse
import base64
import re
from pathlib import Path
from typing import Any

from common import (
    DATA_DIR,
    EXPORTS_ICONS,
    EXPORTS_RAW,
    REPO_ROOT,
    ascii_runs,
    current_usmap_name,
    extract_fstrings,
    load_json,
    pick_persistence_id,
    write_json,
)

EXPORTS_RAW_SKILLS = REPO_ROOT / 'exports' / 'raw_skills'
EXPORTS_LEGACY_SKILLS = REPO_ROOT / 'exports' / 'legacy_skills'
SKILLS_DIR = DATA_DIR / 'skills'
PID_RE = re.compile(r'^[A-Za-z0-9_-]{20,24}$')

SKILL_ORDER = [
    'Attack',
    'Ranged',
    'Magic',
    'Defence',
    'Agility',
    'Mining',
    'Woodcutting',
    'Artisan',
    'Construction',
    'Cooking',
    'Farming',
    'Fishing',
    'Runecrafting',
    'Herblore',
    'Thieving',
]


def skill_display_name(stem: str) -> str:
    return re.sub(r'^SKILL_', '', stem, flags=re.I)


def texture_basename(entry: str) -> str | None:
    base = entry.replace('\\', '/').split('/')[-1].split('.')[0]
    if not base.startswith('T_'):
        return None
    return f'{base}.png'


def skill_icon_candidates(namemap: list[Any]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for entry in namemap:
        if not isinstance(entry, str):
            continue
        icon = texture_basename(entry)
        if not icon or icon.lower() in seen:
            continue
        seen.add(icon.lower())
        names.append(icon)

    ranked: list[str] = []
    for prefix in ('T_Icon_Tag_Skill_', 'T_Icon_SkillTree_', 'T_Notification_Skill_'):
        for name in names:
            if name.startswith(prefix):
                ranked.append(name)
    return ranked


def icon_fallbacks(skill_name: str) -> list[str]:
    aliases = [skill_name]
    if skill_name == 'Artisan':
        aliases.append('Crafting')
    names: list[str] = []
    for prefix in ('T_Icon_Tag_Skill_', 'T_Icon_SkillTree_', 'T_Notification_Skill_'):
        for alias in aliases:
            names.append(f'{prefix}{alias}.png')
    return names


def uexp_bytes_for_json(json_path: Path) -> bytes:
    rel = json_path.as_posix()
    marker = '/raw_skills/'
    if marker in rel:
        legacy = Path(rel.replace('/raw_skills/', '/legacy_skills/', 1)).with_suffix('.uexp')
        if legacy.exists():
            return legacy.read_bytes()
    sibling = json_path.with_suffix('.uexp')
    if sibling.exists():
        return sibling.read_bytes()
    return b''


def parse_skill(path: Path) -> dict[str, Any] | None:
    data = load_json(path)
    if not isinstance(data, dict) or 'Exports' not in data:
        return None
    exports = data.get('Exports') or []
    if not exports:
        return None

    strings: list[str] = []
    raw = exports[0].get('Data')
    if isinstance(raw, str):
        try:
            strings.extend(extract_fstrings(base64.b64decode(raw)))
            strings.extend(ascii_runs(base64.b64decode(raw)))
        except Exception:
            pass
    uexp = uexp_bytes_for_json(path)
    if uexp:
        strings.extend(extract_fstrings(uexp))
        strings.extend(ascii_runs(uexp))

    pid = pick_persistence_id(strings)
    if not pid:
        for s in strings:
            if PID_RE.match(s) and not s.startswith('skill_'):
                pid = s
                break
    if not pid:
        return None

    namemap = data.get('NameMap') or []
    name = skill_display_name(path.stem)
    deprecated = 'DeprecatedSkills' in path.as_posix()
    return {
        'persistenceId': pid,
        'name': name,
        'rowName': path.stem,
        'icons': skill_icon_candidates(namemap if isinstance(namemap, list) else []),
        'deprecated': deprecated or None,
        'sourceAsset': path.name,
    }


def index_pngs(root: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    if not root.exists():
        return found
    for path in root.rglob('*.png'):
        key = path.name.lower()
        prev = found.get(key)
        if prev is None or len(path.as_posix()) < len(prev.as_posix()):
            found[key] = path
    return found


def copy_icons(skills: list[dict[str, Any]]) -> tuple[int, list[str]]:
    index = index_pngs(EXPORTS_ICONS)
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    for stale in SKILLS_DIR.glob('*.png'):
        stale.unlink()
    copied = 0
    missing: list[str] = []
    for skill in skills:
        chosen: str | None = None
        src: Path | None = None
        candidates = [*icon_fallbacks(skill['name']), *skill.pop('icons', [])]
        seen: set[str] = set()
        for icon in candidates:
            key = icon.lower()
            if key in seen:
                continue
            seen.add(key)
            hit = index.get(key)
            if hit:
                chosen = icon
                src = hit
                break
        skill['icon'] = chosen
        if not chosen or not src:
            missing.append(skill['name'])
            continue
        (SKILLS_DIR / chosen).write_bytes(src.read_bytes())
        copied += 1
    return copied, missing


def main() -> int:
    parser = argparse.ArgumentParser(description='Normalize SKILL_* dumps into data/skills.json')
    parser.add_argument('--raw-root', type=Path, default=EXPORTS_RAW_SKILLS)
    parser.add_argument('--fallback-raw', type=Path, default=EXPORTS_RAW / 'Gameplay')
    args = parser.parse_args()

    roots = [args.raw_root]
    if args.fallback_raw.exists():
        roots.append(args.fallback_raw)

    by_id: dict[str, dict[str, Any]] = {}
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob('SKILL_*.json'):
            skill = parse_skill(path)
            if not skill:
                continue
            by_id[skill['persistenceId']] = skill

    skills = list(by_id.values())
    order = {name: i for i, name in enumerate(SKILL_ORDER)}
    skills.sort(key=lambda s: (s.get('deprecated') is True, order.get(s['name'], 99), s['name']))

    copied, missing = copy_icons(skills)
    payload = {
        'meta': {
            'usmap': current_usmap_name(),
            'count': len(skills),
            'iconsCopied': copied,
            'iconsMissing': missing,
        },
        'skills': [{k: v for k, v in skill.items() if v is not None} for skill in skills],
    }
    out = DATA_DIR / 'skills.json'
    write_json(out, payload)
    print(f'Wrote {len(skills)} skills -> {out}')
    print(f'Icons: {copied} copied, {len(missing)} missing')
    if missing:
        print('  missing:', ', '.join(missing))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
