import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

const isWindows = process.platform === 'win32'
const outputDir = resolve('build', 'tools')

function findOnPath(base) {
  const names = isWindows ? [`${base}.exe`, base] : [base]
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  if (isWindows && process.env.LOCALAPPDATA) {
    dirs.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'))
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return realpathSync(candidate)
    }
  }
  return null
}

mkdirSync(outputDir, { recursive: true })

for (const tool of ['yt-dlp', 'ffmpeg']) {
  const source = findOnPath(tool)
  if (!source) {
    throw new Error(`${tool} was not found. Install it before building a portable Snag package.`)
  }
  const filename = isWindows ? `${tool}.exe` : tool
  const destination = join(outputDir, filename)
  copyFileSync(source, destination)
  console.log(`Bundled ${tool}: ${source}`)
}
