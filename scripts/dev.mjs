import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const editorRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const pathSep = isWin ? ';' : ':'
const cargoBin = join(homedir(), '.cargo', 'bin')

const env = {
  ...process.env,
  PATH: `${cargoBin}${pathSep}${process.env.PATH ?? ''}`,
}

function onPath(name) {
  const exe = isWin && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name
  for (const dir of env.PATH.split(pathSep)) {
    if (dir && existsSync(join(dir, exe))) return true
  }
  return false
}

if (!onPath('cargo')) {
  console.error(`Rust cargo not found at ${cargoBin}. Install rustup from https://rustup.rs and reopen the terminal.`)
  process.exit(1)
}

function vcvarsPath() {
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) return null
  try {
    const install = execFileSync(vswhere, [
      '-latest',
      '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8' }).trim()
    const bat = join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    return existsSync(bat) ? bat : null
  } catch {
    return null
  }
}

const childOpts = {
  cwd: editorRoot,
  env,
  stdio: 'inherit',
}

let child
if (isWin && !onPath('link')) {
  const vcvars = vcvarsPath()
  if (!vcvars) {
    console.error('MSVC link.exe not found. Install Visual Studio Build Tools with "Desktop development with C++".')
    process.exit(1)
  }
  child = spawn(
    `call "${vcvars}" && npm run tauri -- dev`,
    { ...childOpts, shell: true },
  )
} else {
  child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'tauri', '--', 'dev'], {
    ...childOpts,
    shell: isWin,
  })
}
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
