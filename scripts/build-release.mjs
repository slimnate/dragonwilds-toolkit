import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const mainBinaryName = `DragonwildsToolkit-${version}`

const tauri = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const result = spawnSync(
  process.execPath,
  [tauri, 'build', '--no-bundle', '--config', JSON.stringify({ mainBinaryName })],
  { cwd: root, stdio: 'inherit' },
)

process.exit(result.status ?? 1)
