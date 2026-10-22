/** Cumulative XP required to reach each level. Shared by all skills; 99 is 1,000,000 XP. */
export const SKILL_MAX_LEVEL = 99

export const SKILL_XP_FOR_LEVEL: readonly number[] = [
  0, 0, 33, 70, 111, 156, 206, 261, 322, 389, 463, 545, 636, 736, 847, 969, 1104, 1253,
  1417, 1598, 1798, 2018, 2261, 2529, 2825, 3152, 3512, 3910, 4349, 4833, 5367, 5957,
  6608, 7326, 8118, 8993, 9958, 11023, 12199, 13496, 14929, 16510, 18255, 20181, 22307,
  24654, 27245, 30105, 33262, 36747, 40594, 44581, 48717, 52997, 57421, 61990, 66702,
  71560, 76562, 81708, 86998, 92433, 98012, 103735, 109603, 115616, 121772, 128073,
  134518, 141108, 147842, 154721, 161743, 168910, 176222, 183678, 191278, 199022,
  206911, 214944, 223122, 231444, 239910, 248521, 257276, 266176, 275219, 284407,
  293740, 303217, 312838, 322604, 332514, 342568, 395129, 447689, 543044, 666881,
  819200, 1000000,
]

export type SkillProgress = {
  level: number
  nextLevel: number
  into: number
  needed: number
  remaining: number
  pct: number
  maxed: boolean
}

/** Cumulative XP at the start of a level. Levels clamp to 1–99. */
export function xpForLevel(level: number): number {
  const clamped = Math.min(SKILL_MAX_LEVEL, Math.max(1, Math.round(level)))
  return SKILL_XP_FOR_LEVEL[clamped] ?? 0
}

export function skillProgress(xp: number): SkillProgress {
  const total = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0))
  let level = 1
  for (let i = SKILL_MAX_LEVEL; i >= 1; i -= 1) {
    const threshold = SKILL_XP_FOR_LEVEL[i]
    if (threshold !== undefined && total >= threshold) {
      level = i
      break
    }
  }
  if (level >= SKILL_MAX_LEVEL) {
    return {
      level: SKILL_MAX_LEVEL,
      nextLevel: SKILL_MAX_LEVEL,
      into: 0,
      needed: 0,
      remaining: 0,
      pct: 100,
      maxed: true,
    }
  }
  const current = SKILL_XP_FOR_LEVEL[level] ?? 0
  const next = SKILL_XP_FOR_LEVEL[level + 1] ?? current
  const needed = Math.max(1, next - current)
  const into = Math.min(needed, Math.max(0, total - current))
  return {
    level,
    nextLevel: level + 1,
    into,
    needed,
    remaining: needed - into,
    pct: (into / needed) * 100,
    maxed: false,
  }
}
