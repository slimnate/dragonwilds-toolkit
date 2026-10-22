export function randomInstanceGuid(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function isPersistenceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,24}$/.test(value)
}
