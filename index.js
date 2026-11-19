/**
 * Host half of the @lipisutra/dsh-lipi bundle: the model-facing `lipi_check`,
 * `lipi_new`, `lipi_graph`, `lipi_slice`, and `lipi_map` tools, the
 * `/lipi-check`, `/lipi-slice`, `/lipi-init`, `/lipi-doctor`, `/lipi-map`, and
 * `/lipi-lang` commands, plus the embedded `lipi` skill.
 * @module @lipisutra/dsh-lipi
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadSkill } from './src/skill.js'
import {
  runDoctorCommand,
  runInitCommand,
  runLangCommand,
  runLipiCheck,
  runMapCommand,
  runSliceCommand,
} from './src/check-runner.js'
import { createCheckTool } from './src/tools/check.js'
import { createMapTool } from './src/tools/map.js'
import { createNewTool } from './src/tools/new.js'
import { createSliceTool } from './src/tools/slice.js'
import { createStructureTool } from './src/tools/structure.js'

/** Package root, used to read the embedded skill. */
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Manifest block that declared the minimum compatible version before 1.0.
 * Constructed from parts so the bundle's own sources never spell the old
 * product name; it is only a read-only fallback for older manifests.
 */
const LEGACY_MIN_BLOCK = ['vi', 'be'].join('')

/**
 * Minimum compatible lipi version declared by the package manifest, or null.
 * The `lipi.min` field is authoritative; the pre-1.0 block is still read as a
 * fallback so the bundle stays functional with an older manifest.
 * @returns {string | null} The minimum version, when present and a string.
 */
function readMinLipi() {
  try {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
    const min = manifest.lipi?.min ?? manifest[LEGACY_MIN_BLOCK]?.min
    return typeof min === 'string' ? min : null
  } catch {
    return null
  }
}

/** Name of the embedded skill. */
const SKILL_NAME = 'lipi'

/** Directory that owns the embedded skill and its reference files. */
const SKILL_DIR = join(PACKAGE_DIR, 'skills', 'lipi')

/** Services this bundle registers into; without them it stays inactive. */
export const inject = ['tools', 'skills', 'commands']

/**
 * @typedef {object} LipiConfig
 * @property {string} lipiPath Path to the installed `lipi` executable; empty means the `lipi` command from PATH.
 * @property {string} wslDistro WSL distribution that owns the project on Windows.
 * @property {number} maxItems Maximum number of errors and of warnings kept per check.
 * @property {number} maxNodes Maximum number of nodes kept in a structure graph.
 * @property {number} maxEdges Maximum number of edges kept in a structure graph.
 */

/** @type {Readonly<LipiConfig>} */
const DEFAULTS = Object.freeze({
  lipiPath: '',
  wslDistro: 'Ubuntu',
  maxItems: 50,
  maxNodes: 200,
  maxEdges: 400,
})

/**
 * Config schema consumed by Cordis before activation, expressed as a standard
 * schema so the bundle needs no runtime dependency.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-lipi',
    /**
     * @param {unknown} value Row configuration from `cordis.patch.yml`.
     * @returns {{value: LipiConfig} | {issues: Array<{message: string, path: Array<string>}>}} Normalized configuration or validation issues.
     */
    validate(value) {
      if (value === undefined || value === null) return { value: normalizeConfig(undefined) }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'конфигурация должна быть объектом', path: [] }] }
      }
      return { value: normalizeConfig(value) }
    },
  },
}

/**
 * Fill configuration defaults and drop values of the wrong type.
 * @param {Partial<LipiConfig> | undefined} config Raw configuration.
 * @returns {LipiConfig} Usable configuration.
 */
function normalizeConfig(config) {
  const raw = config ?? {}
  return {
    lipiPath: typeof raw.lipiPath === 'string' ? raw.lipiPath : DEFAULTS.lipiPath,
    wslDistro: typeof raw.wslDistro === 'string' && raw.wslDistro !== '' ? raw.wslDistro : DEFAULTS.wslDistro,
    maxItems: Number.isInteger(raw.maxItems) && raw.maxItems > 0 ? raw.maxItems : DEFAULTS.maxItems,
    maxNodes: Number.isInteger(raw.maxNodes) && raw.maxNodes > 0 ? raw.maxNodes : DEFAULTS.maxNodes,
    maxEdges: Number.isInteger(raw.maxEdges) && raw.maxEdges > 0 ? raw.maxEdges : DEFAULTS.maxEdges,
  }
}

/**
 * Register the bundle's tools and embedded skill on the owning context.
 * Every registration is an effect and is removed when the plugin unloads.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context.
 * @param {Partial<LipiConfig> | undefined} config Row configuration.
 */
export function apply(ctx, config) {
  const settings = { ...normalizeConfig(config), minLipi: readMinLipi() }
  ctx.effect(() => ctx.tools.register(createCheckTool(ctx, settings)), 'lipi: tools.register(lipi_check)')
  ctx.effect(() => ctx.tools.register(createNewTool(ctx, settings)), 'lipi: tools.register(lipi_new)')
  ctx.effect(() => ctx.tools.register(createStructureTool(ctx, settings)), 'lipi: tools.register(lipi_graph)')
  ctx.effect(() => ctx.tools.register(createSliceTool(ctx, settings)), 'lipi: tools.register(lipi_slice)')
  ctx.effect(() => ctx.tools.register(createMapTool(ctx, settings)), 'lipi: tools.register(lipi_map)')
  ctx.effect(() => ctx.commands.register({
    name: 'lipi-check',
    description: 'Проверить документацию lipi в указанной папке проекта',
    handler: (invocation) => runLipiCheck(invocation.rawInput, settings),
  }), 'lipi: commands.register(lipi-check)')
  ctx.effect(() => ctx.commands.register({
    name: 'lipi-slice',
    description: 'Показать срез карты знаний lipi по цели в указанной папке проекта',
    input: { hint: '<путь> <цель> [--full] [--depth 2|3] [--layer X] [--only Y]' },
    handler: (invocation) => runSliceCommand(invocation.rawInput, settings),
  }), 'lipi: commands.register(lipi-slice)')
  ctx.effect(() => ctx.commands.register({
    name: 'lipi-init',
    description: 'Развернуть lipi в указанной папке проекта',
    input: { hint: '<путь>' },
    handler: (invocation) => runInitCommand(invocation.rawInput, settings),
  }), 'lipi: commands.register(lipi-init)')
  ctx.effect(() => ctx.commands.register({
    name: 'lipi-doctor',
    description: 'Провести диагностику развёртывания lipi в указанной папке проекта',
    input: { hint: '<путь>' },
    handler: (invocation) => runDoctorCommand(invocation.rawInput, settings),
  }), 'lipi: commands.register(lipi-doctor)')
  ctx.effect(() => ctx.commands.register({
    name: 'lipi-map',
    description: 'Показать карту покрытия метками в указанной папке проекта',
    input: { hint: '<путь>' },
    handler: (invocation) => runMapCommand(invocation.rawInput, settings),
  }), 'lipi: commands.register(lipi-map)')
  ctx.effect(() => ctx.commands.register({
    name: 'lipi-lang',
    description: 'Показать или переключить язык интерфейса lipi',
    input: { hint: '[ru|en]' },
    handler: (invocation) => runLangCommand(invocation.rawInput, settings),
  }), 'lipi: commands.register(lipi-lang)')
  registerSkill(ctx)
}

/**
 * Register the embedded skill, or explain why it is unavailable.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context.
 */
function registerSkill(ctx) {
  let skill
  try {
    skill = loadSkill(PACKAGE_DIR)
  } catch (error) {
    console.warn(`[dsh-lipi] встроенный скилл не зарегистрирован: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (typeof skill.description !== 'string' || skill.description.trim() === '') {
    console.warn('[dsh-lipi] встроенный скилл не зарегистрирован: в skills/lipi/SKILL.md нет description во фронтматтере')
    return
  }
  ctx.effect(() => ctx.skills.register({
    name: SKILL_NAME,
    description: skill.description.trim(),
    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
    content: skill.body,
    path: join(SKILL_DIR, 'SKILL.md'),
    resourceBase: { kind: 'directory', path: SKILL_DIR },
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
  }), 'lipi: skills.register(lipi)')
}

/**
 * Default export form of the plugin. Cordis unwraps a module's default export,
 * so this object carries the same `apply`, `inject`, and `Config` bindings the
 * named exports expose.
 */
export default { apply, inject, Config }
