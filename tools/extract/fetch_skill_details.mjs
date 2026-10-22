import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const names = [
  'Attack', 'Ranged', 'Magic', 'Agility', 'Mining', 'Woodcutting', 'Artisan',
  'Construction', 'Cooking', 'Farming', 'Fishing', 'Runecrafting',
  'Defence', 'Herblore', 'Thieving',
]

const headers = {
  'User-Agent': 'rsdw-mods/skill-details (personal save editor; contact local)',
  Accept: 'application/json',
}

function stripWiki(text) {
  return text
    .replace(/\{\{[Pp]link\|([^}]+)\}\}/g, (_, inner) => {
      const parts = inner.split('|')
      const txt = parts.find((part) => part.trim().startsWith('txt='))
      if (txt) return txt.trim().slice(4)
      return parts[0].trim()
    })
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''|''/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function infoboxDescription(wikitext) {
  const match = wikitext.match(/\{\{Infobox Skill[\s\S]*?\n\|description\s*=\s*([^\n|]+)/)
  return match ? stripWiki(match[1]) : ''
}

function levellingTable(wikitext) {
  const tables = [...wikitext.matchAll(/\{\|[\s\S]*?\|\}/g)].map((match) => match[0])
  return tables.findLast((table) => /!Level\s*!Ability\s*!Type\s*!Description/.test(table.replace(/\n/g, '')))
    ?? tables.findLast((table) => /!Level/.test(table) && /!Ability/.test(table) && /!Description/.test(table))
}

function parseRows(table) {
  return table.split(/\n\|-/).slice(1).map((chunk) => {
    const cells = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('|') && !line.startsWith('|}'))
      .map((line) => stripWiki(line.replace(/^\|/, '')))
    if (cells.length < 4) return null
    return { level: cells[0], name: cells[1], kind: cells[2].toLowerCase(), description: cells[3] }
  }).filter(Boolean)
}

function parseBuff(row) {
  const summary = row.description
  const perMatch = summary.match(/([\d.]+)% per level/i)
  const capMatch = summary.match(/(?:until|to)\s+([\d.]+)%[^.\n]*level 99/i)
  const perLevel = perMatch ? Number(perMatch[1]) : undefined
  const cap = capMatch ? Number(capMatch[1]) : undefined
  let stacksFrom
  if (perLevel) {
    const from1 = Math.abs(99 * perLevel - (cap ?? 99 * perLevel))
    const from2 = Math.abs(98 * perLevel - (cap ?? 98 * perLevel))
    stacksFrom = cap === undefined || from1 <= from2 ? 1 : 2
  }
  return {
    name: row.name,
    summary,
    ...(perLevel ? { perLevel, stacksFrom } : {}),
    reduce: /reduc/i.test(summary),
  }
}

async function fetchSkill(name) {
  const url = `https://dragonwilds.runescape.wiki/api.php?action=parse&page=${encodeURIComponent(name)}&prop=wikitext&format=json`
  const response = await fetch(url, { headers })
  if (!response.ok) return null
  const json = await response.json()
  const wikitext = json?.parse?.wikitext?.['*']
  if (!wikitext || !wikitext.includes('Infobox Skill')) return null
  const table = levellingTable(wikitext)
  const rows = table ? parseRows(table) : []
  const all = rows.find((row) => row.level.toLowerCase() === 'all')
  const unlocks = rows
    .filter((row) => /^\d+$/.test(row.level))
    .map((row) => ({ level: Number(row.level), name: row.name, kind: row.kind, description: row.description }))
    .sort((a, b) => a.level - b.level)
  return {
    name,
    description: infoboxDescription(wikitext),
    ...(all ? { buff: parseBuff(all) } : {}),
    unlocks,
  }
}

const skills = []
for (const name of names) {
  const skill = await fetchSkill(name)
  console.log(name, skill ? `${skill.unlocks.length} unlocks` : 'missing')
  if (skill) skills.push(skill)
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'skill-details.json')
writeFileSync(out, `${JSON.stringify({ skills }, null, 2)}\n`)
console.log('wrote', out)
