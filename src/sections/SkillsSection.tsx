import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ItemIcon } from '../components/ItemIcon';
import {
  catalogSpells,
  getSkill,
  skillLabel,
  skills as skillCatalog,
} from '../catalog';
import { asObject, getGameplayRoot, getString } from '../saves/access';
import {
  SKILL_MAX_LEVEL,
  SKILL_XP_FOR_LEVEL,
  skillProgress,
  xpForLevel,
} from '../saves/skillXp';
import type {
  CatalogSkill,
  JsonObject,
  JsonValue,
  SkillBuff,
  SkillUnlock,
} from '../saves/types';

type Props = {
  save: JsonObject;
  onChange: (save: JsonObject) => void;
};

type SkillRow = { Id: string; Xp: number };

type ShownUnlock = SkillUnlock & { minor?: boolean };

export function SkillsSection({ save, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const skillsRoot = asObject(getGameplayRoot(save).Skills);
  const list = Array.isArray(skillsRoot?.Skills)
    ? skillsRoot.Skills.filter(isSkill)
    : [];
  const byId = new Map(list.map((skill) => [skill.Id, skill]));
  const known = skillCatalog.filter(
    (skill) => !skill.deprecated || byId.has(skill.id),
  );
  const extra = list.filter((skill) => !getSkill(skill.Id));
  const missing = skillCatalog.filter(
    (skill) => !skill.deprecated && !byId.has(skill.id),
  );
  const entries: CatalogSkill[] = [
    ...known,
    ...extra.map((skill) => ({ id: skill.Id, name: skillLabel(skill.Id) })),
  ];
  const selected =
    entries.find((skill) => skill.id === selectedId) ?? entries[0];

  function write(nextList: SkillRow[]) {
    const next = structuredClone(save);
    const gameplay = getGameplayRoot(next);
    const root = asObject(gameplay.Skills) ?? {};
    root.Skills = nextList as unknown as JsonValue[];
    gameplay.Skills = root;
    onChange(next);
  }

  function setXp(id: string, xp: number) {
    const copy = list.map((entry) => ({ ...entry }));
    const index = copy.findIndex((entry) => entry.Id === id);
    if (index >= 0) copy[index] = { ...copy[index], Xp: xp };
    else copy.push({ Id: id, Xp: xp });
    write(copy);
  }

  return (
    <section className='panel skills-page'>
      <div className='panel-head skills-head'>
        <h2>Skills</h2>
        <button
          type='button'
          className={editing ? 'section-edit on' : 'section-edit'}
          aria-label={editing ? 'Hide XP editors' : 'Edit skill XP'}
          aria-pressed={editing}
          onClick={() => setEditing((open) => !open)}
        >
          <PencilIcon />
          {editing ? 'Done' : 'Edit'}
        </button>
        {missing.length ? (
          <button
            type='button'
            className='skills-add'
            onClick={() =>
              write([
                ...list,
                ...missing.map((skill) => ({ Id: skill.id, Xp: 0 })),
              ])
            }
          >
            Add missing
          </button>
        ) : null}
      </div>
      <div className='skill-stage'>
        <div className='skill-rail' role='listbox' aria-label='Skills'>
          {entries.map((skill) => {
            const xp = byId.get(skill.id)?.Xp ?? 0;
            const progress = skillProgress(xp);
            const active = skill.id === selected?.id;
            return (
              <button
                key={skill.id}
                type='button'
                role='option'
                aria-selected={active}
                className={active ? 'skill-rail-item on' : 'skill-rail-item'}
                onClick={() => setSelectedId(skill.id)}
              >
                <ItemIcon
                  icon={skill.icon}
                  alt=''
                  size={36}
                  folder='skills'
                  className='skill-rail-icon'
                />
                <span className='skill-rail-name'>{skill.name}</span>
                <span className='skill-level'>
                  {progress.level}
                  <span className='skill-level-cap'> / {SKILL_MAX_LEVEL}</span>
                </span>
              </button>
            );
          })}
        </div>
        {selected ? (
          <SkillDetail
            skill={selected}
            xp={byId.get(selected.id)?.Xp ?? 0}
            editing={editing}
            onXpChange={(xp) => setXp(selected.id, xp)}
          />
        ) : (
          <p className='hint'>No skills in this save.</p>
        )}
      </div>
    </section>
  );
}

function SkillDetail({
  skill,
  xp,
  editing,
  onXpChange,
}: {
  skill: CatalogSkill;
  xp: number;
  editing: boolean;
  onXpChange: (xp: number) => void;
}) {
  const progress = skillProgress(xp);
  const nextTotal = progress.maxed
    ? (SKILL_XP_FOR_LEVEL[SKILL_MAX_LEVEL] ?? xp)
    : (SKILL_XP_FOR_LEVEL[progress.level + 1] ?? xp);
  const rows = unlockRows(skill);
  const amount = buffAmount(skill.buff, progress.level);
  const activeBuff = currentBuffUnlock(skill, progress.level);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = listRef.current?.querySelector('[data-current="true"]');
    current?.scrollIntoView({ block: 'center' });
  }, [skill.id, progress.level]);

  return (
    <>
      <div className='skill-detail'>
        <div className='skill-detail-head'>
          <ItemIcon
            icon={skill.icon}
            alt=''
            size={72}
            folder='skills'
            className='skill-detail-icon'
          />
          <div>
            <h3>{skill.name}</h3>
            {skill.deprecated ? <span className='tiny'>Deprecated</span> : null}
          </div>
        </div>
        <div className='skill-detail-progress'>
          <div className='skill-level-step'>
            {editing ? (
              <button
                type='button'
                className='skill-step'
                aria-label='Previous level'
                title={
                  progress.level > 1
                    ? `Set to level ${progress.level - 1}`
                    : 'Already level 1'
                }
                disabled={progress.level <= 1}
                onClick={() => onXpChange(xpForLevel(progress.level - 1))}
              >
                −
              </button>
            ) : null}
            <p className='skill-detail-level'>{progress.level}</p>
            {editing ? (
              <button
                type='button'
                className='skill-step'
                aria-label='Next level'
                title={
                  progress.maxed
                    ? 'Already max level'
                    : `Set to level ${progress.level + 1}`
                }
                disabled={progress.maxed}
                onClick={() => onXpChange(xpForLevel(progress.level + 1))}
              >
                +
              </button>
            ) : null}
          </div>
          <div
            className='skill-bar skill-detail-bar'
            style={{ '--pct': `${progress.pct}%` } as CSSProperties}
            title={
              progress.maxed
                ? 'Max level'
                : `${formatXp(progress.remaining)} XP to ${progress.nextLevel}`
            }
          >
            <span className='skill-bar-fill' />
          </div>
          <p className='skill-detail-xp'>
            {progress.maxed
              ? `${formatXp(xp)} XP`
              : `${formatXp(xp)} / ${formatXp(nextTotal)} XP`}
          </p>
        </div>
        {amount != null && skill.buff ? (
          <div className='skill-buff'>
            <strong>
              {skill.buff.reduce ? '-' : '+'}
              {formatPct(amount)}%
            </strong>
            <span>{skill.buff.name}</span>
          </div>
        ) : activeBuff ? (
          <div className='skill-buff'>
            <span className='skill-buff-name'>{activeBuff.name}</span>
            <span>{activeBuff.description}</span>
          </div>
        ) : skill.buff ? (
          <div className='skill-buff'>
            <span className='skill-buff-name'>{skill.buff.name}</span>
            <span>{skill.buff.summary}</span>
          </div>
        ) : null}
        {skill.description ? (
          <p className='skill-flavour'>{skill.description}</p>
        ) : null}
        {editing ? (
          <>
            <div className='vital-divider' aria-hidden='true' />
            <label className='vital-number'>
              XP
              <input
                type='number'
                min={0}
                value={xp}
                onChange={(event) => onXpChange(Number(event.target.value))}
              />
            </label>
          </>
        ) : null}
      </div>
      <div className='skill-unlocks' ref={listRef}>
        {rows.length ? (
          rows.map((row) => {
            const unlocked = progress.level >= row.level;
            const current = row.level === progress.level;
            const icon = unlockIcon(skill.name, row);
            return (
              <div
                key={`${row.level}-${row.name}`}
                className={`skill-unlock${unlocked ? ' unlocked' : ''}${current ? ' current' : ''}`}
                data-current={current ? 'true' : undefined}
                title={row.description}
              >
                <span className='skill-unlock-level'>{row.level}</span>
                {row.minor || !icon ? (
                  <span className='skill-unlock-diamond' aria-hidden='true' />
                ) : (
                  <ItemIcon
                    icon={icon}
                    alt=''
                    size={28}
                    folder='spells'
                    className='skill-unlock-icon'
                  />
                )}
                <span className='skill-unlock-name'>{row.name}</span>
              </div>
            );
          })
        ) : (
          <p className='hint'>No level unlocks for this skill.</p>
        )}
      </div>
    </>
  );
}

function unlockRows(skill: CatalogSkill): ShownUnlock[] {
  const named = skill.unlocks ?? [];
  const buff = skill.buff;
  if (!buff?.perLevel || buff.stacksFrom == null) return named;
  const byLevel = new Map(named.map((unlock) => [unlock.level, unlock]));
  const start = buff.stacksFrom ?? 1;
  const rows: ShownUnlock[] = named.filter((unlock) => unlock.level < start);
  const sign = buff.reduce ? '-' : '+';
  for (let level = start; level <= SKILL_MAX_LEVEL; level += 1) {
    const unlock = byLevel.get(level);
    if (unlock) rows.push(unlock);
    else {
      rows.push({
        level,
        name: `${sign}${formatPct(buff.perLevel)}% ${buff.name}`,
        kind: 'passive',
        description: buff.summary,
        minor: true,
      });
    }
  }
  return rows;
}

function buffAmount(buff: SkillBuff | undefined, level: number): number | null {
  if (!buff?.perLevel || buff.stacksFrom == null) return null;
  return Math.max(0, level - buff.stacksFrom + 1) * buff.perLevel;
}

function currentBuffUnlock(
  skill: CatalogSkill,
  level: number,
): SkillUnlock | undefined {
  const name = skill.buff?.name;
  if (!name || skill.buff?.perLevel) return undefined;
  return [...(skill.unlocks ?? [])]
    .reverse()
    .find((unlock) => unlock.level <= level && unlock.name.startsWith(name));
}

function unlockIcon(
  skillName: string,
  unlock: ShownUnlock,
): string | undefined {
  if (unlock.minor) return undefined;
  const wanted = unlock.name.toLowerCase();
  return catalogSpells.find(
    (spell) => spell.skill === skillName && spell.name.toLowerCase() === wanted,
  )?.icon;
}

function formatPct(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function formatXp(value: number): string {
  return value.toLocaleString('en-US');
}

function PencilIcon() {
  return (
    <svg viewBox='0 0 16 16' width='14' height='14' aria-hidden='true'>
      <path
        d='M11.7 1.8l2.5 2.5-8.4 8.4H3.3v-2.5l8.4-8.4z'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinejoin='round'
      />
      <path
        d='M10.2 3.3l2.5 2.5'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
    </svg>
  );
}

function isSkill(value: JsonValue): value is SkillRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  return getString(value, 'Id') !== '' && typeof value.Xp === 'number';
}
