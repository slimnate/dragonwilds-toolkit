import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tauri = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const source = join(root, 'src-tauri', 'icons', 'icon-source.png')

const result = spawnSync(process.execPath, [tauri, 'icon', source], {
  cwd: root,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
