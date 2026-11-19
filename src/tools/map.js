/**
 * `lipi_map`: return the coverage map computed by the installed `lipi map`
 * command for the project, as human-readable text.
 * @module @lipisutra/dsh-lipi/tools/map
 */
import { resolveProject } from '../project.js'
import { runCheck } from '../runner.js'

/** Largest amount of raw lipi output kept for the model. */
const MAX_PARSE_STDOUT_BYTES = 8 * 1024

const MAP_DESCRIPTION = [
  'Карта покрытия метками: запускает установленную команду `lipi map --format json`',
  'в проекте, развёрнутом по lipi (в корне есть lipi.json), и возвращает человекочитаемый',
  'разбор: строку сводки со слоями и числом строк, затем по строке на цель —',
  '«цель — заголовок [вид, статус]: код N (по слоям), тесты M» — и примечание.',
  'Ответ команды: schema 1, layers (слои кода), note и rows; у строки поля target,',
  'title, kind, code (число мест в коде по слоям), tests и status, когда он есть.',
  'Нужны установленный lipi (`pipx install git+https://github.com/lipisutra/lipi`)',
  'и проект с lipi.json.',
].join(' ')

const MAP_PARAMETERS = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Корень проекта. По умолчанию — рабочая папка сессии; укажите путь, если она не внутри проекта или сервис рабочей папки недоступен.',
    },
  },
}

const RESULT_SCHEMA = { type: 'object', additionalProperties: true }

/**
 * Create the `lipi_map` tool definition for one plugin context.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context; the working-directory service is read through `ctx.get`.
 * @param {{lipiPath: string, wslDistro: string}} cfg Valid bundle configuration.
 * @returns {object} A registry-ready tool definition.
 */
export function createMapTool(ctx, cfg) {
  return {
    name: 'lipi_map',
    description: MAP_DESCRIPTION,
    parameters: MAP_PARAMETERS,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: typeof value?.text === 'string' ? value.text : JSON.stringify(value, null, 2),
      }],
    },
    /**
     * @param {{path?: string}} args Validated arguments.
     * @param {{agent?: {session: object}}} exec Execution context.
     * @returns {Promise<object>} Map result with `text`, or a tool-level error.
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
        result = runCheck(project, mapArguments(), cfg)
      } catch (error) {
        return withHint({ error: messageOf(error) }, cfg)
      }
      const parsed = parseMapResult(result.stdout, result.code, { stderr: result.stderr })
      return parsed.error === undefined ? { ...parsed, root: project.root } : withHint(parsed, cfg)
    },
  }
}

/**
 * Turn the tool call into installed lipi command arguments.
 * @returns {string[]} `lipi` command arguments.
 */
export function mapArguments() {
  return ['map', '--format', 'json']
}

/**
 * Parse one `lipi map --format json` answer into a human-readable result.
 *
 * Exit code 2 means bad arguments or settings; 0 must carry `schema`, `layers`
 * and `rows`. Unknown extra fields are kept as-is.
 * @param {string} stdout `lipi map` standard output.
 * @param {number} exitCode Process exit code.
 * @param {{stderr?: string}} [options] Standard error, used for the code-2 detail.
 * @returns {object} Success result with `text`, or an error result with `error`.
 */
export function parseMapResult(stdout, exitCode, options = {}) {
  const out = typeof stdout === 'string' ? stdout : ''
  const stderr = typeof options?.stderr === 'string' ? options.stderr : ''
  const parsed = parseJsonObject(out)
  if (exitCode === 2) {
    const detail = commandDetail(parsed, stderr, out)
    return {
      error: 'неверные аргументы или настройки',
      exitCode,
      ...(detail === '' ? {} : { details: detail }),
    }
  }
  if (exitCode !== 0) {
    const suffix = lastLineSuffix(stderr, out)
    return {
      error: `lipi map завершился с кодом ${exitCode}${suffix === '' ? '' : ': ' + suffix}`,
      exitCode,
    }
  }
  if (parsed === null) {
    return {
      error: `lipi map вернул не JSON${stderr.trim() === '' ? '' : ': ' + stderr.trim()}`,
      exitCode,
      ...(out.trim() === '' ? {} : { stdout: truncateText(out.trim(), MAX_PARSE_STDOUT_BYTES) }),
    }
  }
  if (typeof parsed.error === 'string' && parsed.error !== '') {
    return { error: parsed.error, exitCode }
  }
  if (typeof parsed.schema === 'number' && parsed.schema !== 1) {
    return { error: `неподдерживаемая схема карты: ${parsed.schema} (ожидается 1)`, exitCode }
  }
  const missing = missingSuccessFields(parsed)
  if (missing.length > 0) {
    return {
      error: `неожиданный ответ lipi map: нет обязательных полей ${missing.join(', ')}`,
      exitCode,
      stdout: truncateText(out.trim(), MAX_PARSE_STDOUT_BYTES),
    }
  }
  const layers = parsed.layers.filter((layer) => typeof layer === 'string' && layer !== '')
  const rows = parsed.rows.filter(isPlainObject).map(normalizeRow)
  return {
    schema: parsed.schema,
    exitCode,
    layers,
    rows,
    note: typeof parsed.note === 'string' ? parsed.note : '',
    text: renderText(layers, rows, typeof parsed.note === 'string' ? parsed.note : ''),
  }
}

/**
 * Normalize one map row so rendering never depends on optional fields.
 * Unknown row keys are preserved.
 * @param {object} row Raw row.
 * @returns {{target: string, title: string, kind: string, status: string, code: Record<string, number>, tests: number} & object} Normalized row.
 */
function normalizeRow(row) {
  const code = {}
  if (isPlainObject(row.code)) {
    for (const [layer, count] of Object.entries(row.code)) {
      if (typeof count === 'number' && Number.isFinite(count)) code[layer] = count
    }
  }
  return {
    ...row,
    target: typeof row.target === 'string' ? row.target : '',
    title: typeof row.title === 'string' ? row.title : '',
    kind: typeof row.kind === 'string' ? row.kind : '',
    status: typeof row.status === 'string' ? row.status : '',
    code,
    tests: Number.isInteger(row.tests) && row.tests >= 0 ? row.tests : 0,
  }
}

/**
 * Render the human-readable map text.
 * @param {string[]} layers Layer names in output order.
 * @param {object[]} rows Normalized rows.
 * @param {string} note Command note.
 * @returns {string} Text for the model.
 */
function renderText(layers, rows, note) {
  const layerText = layers.length === 0 ? 'нет слоёв' : layers.join(', ')
  const lines = [`карта покрытия: слои — ${layerText}; строк — ${rows.length}`]
  for (const row of rows) lines.push(rowLine(row))
  if (note !== '') lines.push(note)
  return lines.join('\n')
}

/**
 * Render one row: target, title, kind and status, then code and test counts.
 * @param {object} row Normalized row.
 * @returns {string} Row line.
 */
function rowLine(row) {
  let head = row.title === '' ? row.target : `${row.target} — ${row.title}`
  const attributes = [row.kind, row.status].filter((value) => value !== '')
  if (attributes.length > 0) head += ` [${attributes.join(', ')}]`
  const counts = codeCounts(row.code)
  const layers = counts.layers.length === 0 ? '' : ` (${counts.layers.join(', ')})`
  return `${head}: код ${counts.total}${layers}, тесты ${row.tests}`
}

/**
 * Total code places and the non-zero per-layer breakdown.
 * @param {Record<string, number>} code Places per layer.
 * @returns {{total: number, layers: string[]}} Total and per-layer parts.
 */
function codeCounts(code) {
  let total = 0
  const layers = []
  for (const [layer, count] of Object.entries(code)) {
    total += count
    if (count > 0) layers.push(`${layer} ${count}`)
  }
  return { total, layers }
}

/**
 * List the top-level fields a successful answer must carry.
 * @param {object} parsed Parsed stdout.
 * @returns {string[]} Names of absent or malformed fields.
 */
function missingSuccessFields(parsed) {
  const missing = []
  if (typeof parsed.schema !== 'number') missing.push('schema')
  if (!Array.isArray(parsed.layers)) missing.push('layers')
  if (!Array.isArray(parsed.rows)) missing.push('rows')
  return missing
}

/**
 * Extract the useful part of a code-2 failure: a check finding, the `error`
 * field of the JSON, or the last non-empty line of stderr or stdout.
 * @param {object | null} parsed Parsed stdout, when it was a JSON object.
 * @param {string} stderr Command standard error.
 * @param {string} stdout Command standard output.
 * @returns {string} Short detail, or an empty string when nothing is readable.
 */
function commandDetail(parsed, stderr, stdout) {
  if (isPlainObject(parsed) && Array.isArray(parsed.errors)) {
    const first = parsed.errors.find((item) => isPlainObject(item) && typeof item.message === 'string' && item.message !== '')
    if (first !== undefined) return truncateText(first.message, MAX_PARSE_STDOUT_BYTES)
  }
  if (isPlainObject(parsed) && typeof parsed.error === 'string' && parsed.error !== '') {
    return truncateText(parsed.error, MAX_PARSE_STDOUT_BYTES)
  }
  return truncateText(lastLine(stderr) || lastLine(stdout), MAX_PARSE_STDOUT_BYTES)
}

/**
 * The last non-empty line of a text.
 * @param {string} text Source text.
 * @returns {string} Trimmed last line, or an empty string.
 */
function lastLine(text) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '')
  return lines.length === 0 ? '' : lines[lines.length - 1]
}

/**
 * Format the last non-empty line of stderr or stdout as a `: detail` suffix.
 * @param {string} stderr Command standard error.
 * @param {string} stdout Command standard output.
 * @returns {string} Detail, or an empty string.
 */
function lastLineSuffix(stderr, stdout) {
  return lastLine(stderr) || lastLine(stdout)
}

/**
 * Read a JSON object from command output.
 * @param {string} text Standard output.
 * @returns {object | null} Parsed object, or null for non-JSON and non-object values.
 */
function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Whether a value is a plain object.
 * @param {unknown} value Any value.
 * @returns {boolean} True for a non-array object.
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
