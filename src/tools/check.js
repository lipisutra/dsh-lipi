/**
 * `lipi_check`: run the installed `lipi check` command and return its bounded
 * JSON result.
 * @module @lipisutra/dsh-lipi/tools/check
 */
import { resolveProject } from '../project.js'
import { runCheck } from '../runner.js'
import { isOlder } from '../semver.js'

/** Largest amount of non-JSON lipi output kept for the model. */
const MAX_PARSE_STDOUT_BYTES = 8 * 1024

/** Fallback cap for each reported list when the configuration does not set one. */
const DEFAULT_MAX_ITEMS = 50

/** Modes the `lipi check` command understands. */
export const CHECK_MODES = ['quick', 'staged', 'audit']

const CHECK_DESCRIPTION = [
  'Запускает установленную команду lipi в проекте: `lipi check` проверяет ссылки описания',
  'и правила исполнителя, указатель и шапки рабочих материалов, при необходимости —',
  'расхождение кода и описания. Проект должен быть развёрнут по lipi (в корне есть',
  'lipi.json); сама команда lipi должна быть установлена: `pipx install',
  'git+https://github.com/lipisutra/lipi`. Возвращает JSON: root, schema, version, exitCode,',
  'errors, warnings, summary. У каждой находки поля code, file, subject, line и message.',
  'Списки ошибок и предупреждений могут быть обрезаны; truncated и truncatedCount',
  'показывают, была ли обрезка и сколько записей отброшено. Если lipi напечатал не JSON,',
  'возвращает parseError, exitCode, stdout (не больше 8 КиБ) и stderr. Найденные ошибки не',
  'делают вызов неуспешным: решение принимайте по exitCode и спискам.',
].join(' ')

const CHECK_PARAMETERS = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['quick', 'staged', 'audit'],
      default: 'quick',
      description: 'Объём проверки: quick — быстрые проверки (по умолчанию), staged — добавить детектор расхождения по проиндексированным изменениям для pre-commit, audit — расширенный аудит.',
    },
    path: {
      type: 'string',
      description: 'Корень проекта. По умолчанию — рабочая папка сессии; укажите путь, если она не внутри проекта или сервис рабочей папки недоступен.',
    },
  },
}

const RESULT_SCHEMA = { type: 'object', additionalProperties: true }

/**
 * Create the `lipi_check` tool definition for one plugin context.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context; the working-directory service is read through `ctx.get`.
 * @param {{lipiPath: string, wslDistro: string, maxItems: number, minLipi?: string}} cfg Valid bundle configuration.
 * @returns {object} A registry-ready tool definition.
 */
export function createCheckTool(ctx, cfg) {
  return {
    name: 'lipi_check',
    description: CHECK_DESCRIPTION,
    parameters: CHECK_PARAMETERS,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    /**
     * @param {{mode?: string, path?: string}} args Validated arguments.
     * @param {{agent?: {session: object}}} exec Execution context.
     * @returns {Promise<object>} Checker result, parse fallback, or a tool-level error.
     */
    async execute(args, exec) {
      let project
      try {
        project = resolveProject(startDirectory(args, ctx, exec))
      } catch (error) {
        return withHint({ error: messageOf(error) }, cfg)
      }
      let result
      try {
        result = runCheck(project, checkArguments(args.mode), cfg)
      } catch (error) {
        return withHint({ error: messageOf(error) }, cfg)
      }
      const parsed = parseCheckResult(result.stdout, {
        root: project.root,
        exitCode: result.code,
        maxItems: cfg.maxItems,
        stderr: result.stderr,
      })
      if (parsed.parseError !== true && typeof cfg?.minLipi === 'string' && isOlder(parsed.version, cfg.minLipi)) {
        parsed.minLipiHint = `установленный lipi ${parsed.version} старше поддерживаемого минимума ${cfg.minLipi} — обновите: pipx upgrade lipi`
      }
      return parsed.parseError === true ? withHint(parsed, cfg) : parsed
    },
  }
}

/**
 * Turn command arguments for one check mode.
 * @param {string | undefined} mode Requested mode; anything but `staged` and `audit` means quick.
 * @returns {string[]} Installed lipi command arguments.
 */
function checkArguments(mode) {
  if (mode === 'staged') return ['check', '--format', 'json', '--staged']
  if (mode === 'audit') return ['check', '--format', 'json', '--audit']
  return ['check', '--format', 'json']
}

/**
 * Resolve the directory discovery starts from.
 * @param {{path?: string}} args Tool arguments.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context.
 * @param {{agent?: {session: object}}} exec Execution context.
 * @returns {string} Explicit path, or the session working directory.
 */
function startDirectory(args, ctx, exec) {
  if (typeof args.path === 'string' && args.path.trim() !== '') return args.path
  const workingDirectory = ctx.get('workingDirectory')
  const session = exec.agent?.session
  if (workingDirectory !== undefined && session !== undefined) {
    const directory = workingDirectory.get(session)
    if (typeof directory === 'string' && directory !== '') return directory
  }
  throw new Error('не удалось определить рабочую папку сессии: сервис working directory недоступен — укажите path явно')
}

/**
 * Parse one `lipi check` JSON document and cap both reported lists.
 * @param {string} stdout `lipi check` standard output.
 * @param {{root: string, exitCode: number, maxItems?: number, stderr?: string}} options Exit code, project root, and cap.
 * @returns {object} Parsed result with `schema`, `truncated`/`truncatedCount`, or a non-JSON fallback.
 */
export function parseCheckResult(stdout, options) {
  const { root, exitCode, maxItems, stderr = '' } = options
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return {
      parseError: true,
      exitCode,
      stdout: truncateText(stdout.trim(), MAX_PARSE_STDOUT_BYTES),
      stderr,
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      parseError: true,
      exitCode,
      stdout: truncateText(stdout.trim(), MAX_PARSE_STDOUT_BYTES),
      stderr,
    }
  }
  const limit = Number.isInteger(maxItems) && maxItems > 0 ? maxItems : DEFAULT_MAX_ITEMS
  const errors = Array.isArray(parsed.errors) ? parsed.errors : []
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : []
  const keptErrors = errors.slice(0, limit)
  const keptWarnings = warnings.slice(0, limit)
  const truncatedCount = (errors.length - keptErrors.length) + (warnings.length - keptWarnings.length)
  return {
    root,
    schema: parsed.schema ?? null,
    version: typeof parsed.version === 'string' ? parsed.version : null,
    exitCode,
    errors: keptErrors,
    warnings: keptWarnings,
    summary: parsed.summary ?? null,
    truncated: truncatedCount > 0,
    truncatedCount,
  }
}

/**
 * Add the configured lipi installation path to an error result.
 * @param {object} result Error result.
 * @param {{lipiPath: string}} cfg Bundle configuration.
 * @returns {object} The same result, with `hint` when a path is configured.
 */
function withHint(result, cfg) {
  if (typeof cfg.lipiPath !== 'string' || cfg.lipiPath === '') return result
  return { ...result, hint: `Проверьте путь к установленному lipi (lipiPath): ${cfg.lipiPath}` }
}

/**
 * Keep at most `maxBytes` bytes of UTF-8 text, without splitting a character.
 * @param {string} text Source text.
 * @param {number} maxBytes Byte budget.
 * @returns {string} The whole text, or its longest UTF-8-safe prefix.
 */
function truncateText(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let result = ''
  let size = 0
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (size + bytes > maxBytes) break
    result += character
    size += bytes
  }
  return result
}

/**
 * Render an unknown thrown value as text.
 * @param {unknown} error Thrown value.
 * @returns {string} Its message or string form.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
