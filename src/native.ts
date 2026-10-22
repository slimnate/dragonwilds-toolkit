import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { CharacterFileInfo } from './saves/types'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function defaultSaveDir(): Promise<string> {
  if (!isTauri()) return ''
  return invoke<string>('default_save_dir')
}

export async function defaultSavedDir(): Promise<string> {
  if (!isTauri()) return ''
  return invoke<string>('default_saved_dir')
}

export async function openInExplorer(folder: 'saved' | 'characters' | 'worlds'): Promise<void> {
  if (!isTauri()) throw new Error('Opening folders requires the desktop app')
  await invoke('open_in_explorer', { folder })
}

export async function listCharacters(dir?: string): Promise<CharacterFileInfo[]> {
  if (!isTauri()) return []
  return invoke<CharacterFileInfo[]>('list_characters', { dir: dir ?? null })
}

export async function readCharacter(path: string): Promise<string> {
  if (!isTauri()) throw new Error('Open a JSON file from the picker')
  return invoke<string>('read_character', { path })
}

export async function writeCharacter(path: string, contents: string, backup = true): Promise<void> {
  if (!isTauri()) {
    const blob = new Blob([contents], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = path.split(/[/\\]/).pop() ?? 'character.json'
    link.click()
    URL.revokeObjectURL(url)
    return
  }
  await invoke('write_character', { path, contents, backup })
}

export async function pickSaveFile(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null
  const selected = await open({
    multiple: false,
    defaultPath: defaultPath || undefined,
    filters: [{ name: 'Dragonwilds save', extensions: ['json', 'sav'] }],
  })
  if (typeof selected === 'string') return selected
  return null
}

export async function pickCharacterFile(): Promise<string | null> {
  if (!isTauri()) return null
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Character save', extensions: ['json'] }],
  })
  if (typeof selected === 'string') return selected
  return null
}

export async function pickSaveAs(defaultPath?: string, kind: 'json' | 'sav' = 'json'): Promise<string | null> {
  if (!isTauri()) return defaultPath ?? (kind === 'sav' ? 'world.sav' : 'character.json')
  const selected = await save({
    defaultPath,
    filters: [{ name: kind === 'sav' ? 'World save' : 'Character save', extensions: [kind] }],
  })
  return selected ?? null
}

export async function defaultWorldsDir(): Promise<string> {
  if (!isTauri()) return ''
  return invoke<string>('default_worlds_dir')
}

export async function listWorlds(dir?: string): Promise<CharacterFileInfo[]> {
  if (!isTauri()) return []
  return invoke<CharacterFileInfo[]>('list_worlds', { dir: dir ?? null })
}

export type WorldNameInfo = {
  guid: string
  name: string
}

export async function listWorldNames(dir?: string): Promise<WorldNameInfo[]> {
  if (!isTauri()) return []
  return invoke<WorldNameInfo[]>('list_world_names', { dir: dir ?? null })
}

export async function readWorld(path: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error('Open a .sav file from the picker')
  return decodeBase64(await invoke<string>('read_world', { path }))
}

export async function writeWorld(path: string, contents: Uint8Array, backup = true): Promise<void> {
  if (!isTauri()) {
    const copy = new ArrayBuffer(contents.byteLength)
    new Uint8Array(copy).set(contents)
    const blob = new Blob([copy])
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = path.split(/[/\\]/).pop() ?? 'world.sav'
    link.click()
    URL.revokeObjectURL(url)
    return
  }
  await invoke('write_world', { path, contents: encodeBase64(contents), backup })
}

export async function pickWorldFile(): Promise<string | null> {
  if (!isTauri()) return null
  const selected = await open({
    multiple: false,
    filters: [{ name: 'World save', extensions: ['sav'] }],
  })
  if (typeof selected === 'string') return selected
  return null
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index)
  return out
}

export { isTauri }
