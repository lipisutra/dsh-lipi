/**
 * Read the embedded skill from the bundle directory; no Cordis dependency.
 * @module @lipisutra/dsh-lipi/skill
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Fallback skill name when the frontmatter omits one. */
const DEFAULT_SKILL_NAME = 'lipi'

/**
 * Read `skills/lipi/SKILL.md` and split it into routing metadata and body.
 * Only single-line `name:`, `description:`, and `whenToUse:` frontmatter fields
 * are parsed; the body keeps everything after the closing fence.
 * @param {string} pkgDir Package root that contains the `skills` directory.
 * @returns {{name: string, description: string, whenToUse: string | undefined, body: string}} Parsed skill.
 * @throws {Error} When the skill file is unreadable or its frontmatter is unterminated.
 */
export function loadSkill(pkgDir) {
  const file = join(pkgDir, 'skills', 'lipi', 'SKILL.md')
  const markdown = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const lines = markdown.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { name: DEFAULT_SKILL_NAME, description: '', whenToUse: undefined, body: markdown }
  }
  let fenceEnd = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      fenceEnd = index
      break
    }
  }
  if (fenceEnd === -1) throw new Error(`skills/lipi/SKILL.md: незакрытый YAML-фронтматтер в ${file}`)
  const fields = new Map()
  for (const line of lines.slice(1, fenceEnd)) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (key === '') continue
    fields.set(key, unquote(line.slice(colon + 1).trim()))
  }
  return {
    name: fields.get('name') || DEFAULT_SKILL_NAME,
    description: fields.get('description') ?? '',
    whenToUse: fields.get('whenToUse'),
    body: lines.slice(fenceEnd + 1).join('\n').replace(/^\n+/, ''),
  }
}

/**
 * Strip one pair of matching single or double quotes around a frontmatter value.
 * @param {string} value Raw value text.
 * @returns {string} Unquoted value.
 */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}
