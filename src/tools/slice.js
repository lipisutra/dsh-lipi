/**
 * `lipi_slice`: return the knowledge-map slice computed by the installed
 * `lipi slice` command for one target, as human-readable text.
 * @module @lipisutra/dsh-lipi/tools/slice
 */
import { resolveProject } from '../project.js'
import { runCheck } from '../runner.js'

/** Largest amount of raw lipi output kept for the model. */
const MAX_PARSE_STDOUT_BYTES = 8 * 1024

/** Block kinds `lipi slice` can emit; `signals` stays with every `--only`. */
export const SLICE_BLOCKS = ['signals', 'obey', 'excerpt', 'concepts', 'entry', 'code', 'tests', 'targets', 'context']

/** Depths the `--depth` flag accepts. */
export const SLICE_DEPTHS = [2, 3]

/** Human-readable block headings, as the command itself prints them. */
const BLOCK_TITLES = {
  signals: 'Сигналы',
  obey: 'Соблюдать',
  excerpt: 'Понятие',
  concepts: 'Понятия',
  entry: 'С чего начинать',
  code: 'Места в коде',
  tests: 'Тесты',
  targets: 'Цели работы',
  context: 'Контекст',
}

/** Summary keys with their Russian singular, few and many forms, in output order. */
const SUMMARY_PARTS = [
  ['errors', 'ошибка', 'ошибки', 'ошибок'],
  ['warnings', 'предупреждение', 'предупреждения', 'предупреждений'],
  ['decisions', 'решение', 'решения', 'решений'],
  ['rules', 'правило', 'правила', 'правил'],
  ['concepts', 'понятие', 'понятия', 'понятий'],
  ['entry', 'точка входа', 'точки входа', 'точек входа'],
  ['code', 'место в коде', 'места в коде', 'мест в коде'],
  ['tests', 'тест', 'теста', 'тестов'],
  ['open_work', 'открытая работа', 'открытые работы', 'открытых работ'],
  ['targets', 'цель', 'цели', 'целей'],
]

const SLICE_DESCRIPTION = [
  'Срез карты знаний проекта: что нужно знать, чтобы безопасно начать задачу по цели —',
  'разделу, странице, файлу кода или номеру работы. Запускает установленную команду',
  '`lipi slice <цель> --format json` в проекте, развёрнутом по lipi (в корне есть lipi.json),',
  'и возвращает человекочитаемый разбор: строку цели (вид, способ находки, статус, слой),',
  'сводку и блоки в порядке вывода — сигналы (устаревание, метки @trace/covers, открытая работа),',
  '«Соблюдать», выдержку из цели, понятия, точки входа, места в коде, тесты, цели работы и',
  'контекст; сколько элементов скрыто и какими флагами их показать, признак неполноты и',
  'примечания. Вместо цели можно задать источник изменений: diff — срез по изменениям кода',
  'относительно базы Git (цель тогда не нужна), staged — по подготовленным к коммиту изменениям;',
  'выдаются связанные понятия, принятые решения и правила, другие места и тесты изменённого',
  'кода, а в сводке — сколько изменённых мест осталось без меток. Флаги: full — выдержка целиком;',
  'depth 2|3 — связи на два-три шага; layer — слои для мест в коде (можно повторять);',
  'only — только названные блоки (сигналы остаются всегда). Код 0 — срез получен, в том числе',
  'пустой; 1 — цель не найдена или неоднозначна, в ответе error и кандидаты; 2 — неверные',
  'аргументы или настройки. Нужны установленный lipi (`pipx install git+https://github.com/lipisutra/lipi`)',
  'и проект с lipi.json.',
].join(' ')

const SLICE_PARAMETERS = {
  type: 'object',
  properties: {
    target: {
      type: 'string',
      description: 'Цель среза: раздел (`docs/pricing.md#threshold`), страница (`docs/pricing.md`), файл кода (`src/domain/discount.py`) или номер работы (`ISS-007`, `PLN-005`). Другое значение — поиск по якорям, номерам и заголовкам; найдено одно — срез по нему, иначе кандидаты. Не нужна, если задан diff или staged.',
    },
    diff: {
      type: 'string',
      description: 'Диапазон git для среза по изменениям, напр. origin/main...HEAD; вместо цели показывает связи изменённого кода',
    },
    staged: {
      type: 'boolean',
      description: 'Срез по проиндексированным изменениям (git diff --cached)',
    },
    full: {
      type: 'boolean',
      description: 'Отдать выдержку цели целиком, вне общего предела ответа.',
    },
    depth: {
      type: 'integer',
      enum: SLICE_DEPTHS,
      description: 'Глубина связей: 2 или 3 вместо 1 по умолчанию — добавляет соседей соседей; документы в контексте получают depth.',
    },
    layer: {
      type: 'array',
      items: { type: 'string' },
      description: 'Оставить места в коде только этих слоёв; можно указать несколько.',
    },
    only: {
      type: 'array',
      items: { type: 'string', enum: SLICE_BLOCKS },
      description: 'Оставить только названные блоки; блок signals остаётся всегда.',
    },
    path: {
      type: 'string',
      description: 'Корень проекта. По умолчанию — рабочая папка сессии; укажите путь, если она не внутри проекта или сервис рабочей папки недоступен.',
    },
  },
}

const RESULT_SCHEMA = { type: 'object', additionalProperties: true }

/**
 * Create the `lipi_slice` tool definition for one plugin context.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context; the working-directory service is read through `ctx.get`.
 * @param {{lipiPath: string, wslDistro: string}} cfg Valid bundle configuration.
 * @returns {object} A registry-ready tool definition.
 */
export function createSliceTool(ctx, cfg) {
  return {
    name: 'lipi_slice',
    description: SLICE_DESCRIPTION,
    parameters: SLICE_PARAMETERS,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: typeof value?.text === 'string' ? value.text : JSON.stringify(value, null, 2),
      }],
    },
    /**
     * @param {{target?: string, diff?: string, staged?: boolean, full?: boolean, depth?: number, layer?: string[], only?: string[], path?: string}} args Validated arguments.
     * @param {{agent?: {session: object}}} exec Execution context.
     * @returns {Promise<object>} Slice result with `text`, or a tool-level error.
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
        result = runCheck(project, sliceArguments(args.target, args), cfg)
      } catch (error) {
        return withHint({ error: messageOf(error) }, cfg)
      }
      const parsed = parseSliceResult(result.stdout, result.code, { stderr: result.stderr })
      return parsed.error === undefined ? parsed : withHint(parsed, cfg)
    },
  }
}

/**
 * Turn tool arguments into installed lipi command arguments.
 *
 * A slice is built either for one target or for changed code: `diff` passes
 * `--diff <base>`, `staged` passes `--staged`. With a change source the
 * target may be empty; `diff` and `staged` are mutually exclusive.
 * @param {string | undefined} target Slice target: section, page, code file, work number, or search query.
 * @param {{diff?: string, staged?: boolean, full?: boolean, depth?: number, layer?: string | string[], only?: string | string[]}} [flags] Optional slice flags.
 * @returns {string[]} `lipi` command arguments.
 * @throws {Error} When neither a target nor a change source is given, when `diff` and `staged` are combined, or when `depth` is neither 2 nor 3.
 */
export function sliceArguments(target, flags = {}) {
  const options = flags !== null && typeof flags === 'object' ? flags : {}
  const goal = typeof target === 'string' ? target.trim() : ''
  const diff = typeof options.diff === 'string' ? options.diff.trim() : ''
  const staged = options.staged === true
  if (diff !== '' && staged) {
    throw new Error('срез по изменениям: --diff и --staged вместе не задаются')
  }
  if (goal === '' && diff === '' && !staged) {
    throw new Error('цель среза не указана: укажите раздел, страницу, файл кода, номер работы или задайте diff/staged')
  }
  const args = ['slice']
  if (goal !== '') args.push(goal)
  if (diff !== '') args.push('--diff', diff)
  if (staged) args.push('--staged')
  args.push('--format', 'json')
  if (options.full === true) args.push('--full')
  if (options.depth !== undefined && options.depth !== null) {
    const depth = Number(options.depth)
    if (!SLICE_DEPTHS.includes(depth)) {
      throw new Error(`глубина среза — 2 или 3, получено «${options.depth}»`)
    }
    args.push('--depth', String(depth))
  }
  for (const layer of nonEmptyStrings(options.layer)) args.push('--layer', layer)
  const only = nonEmptyStrings(options.only)
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  if (only.length > 0) args.push('--only', only.join(','))
  return args
}

/**
 * Parse one `lipi slice --format json` answer into a human-readable result.
 *
 * Exit code 2 means bad arguments or settings, 1 — the target was not found
 * or is ambiguous (candidates are read from JSON, or from plain text when the
 * command printed no JSON). Exit code 0 must carry `schema`, `target`,
 * `summary` and `blocks`; unknown extra keys are kept as-is, and any other
 * exit code is reported without parsing.
 * @param {string} stdout `lipi slice` standard output.
 * @param {number} exitCode Process exit code.
 * @param {{stderr?: string}} [options] Standard error, used for the code-2 detail.
 * @returns {object} Success result with `text`, or an error result with `error`.
 */
export function parseSliceResult(stdout, exitCode, options = {}) {
  const out = typeof stdout === 'string' ? stdout : ''
  const stderr = typeof options?.stderr === 'string' ? options.stderr : ''
  const parsed = parseJsonObject(out)
  if (exitCode === 2) return commandError(parsed, stderr, out)
  if (exitCode === 1) return targetError(parsed, out)
  if (exitCode !== 0) {
    return {
      error: `lipi slice завершился с кодом ${exitCode}`,
      exitCode,
      ...(out.trim() === '' ? {} : { stdout: truncateText(out.trim(), MAX_PARSE_STDOUT_BYTES) }),
      ...(stderr.trim() === '' ? {} : { stderr: truncateText(stderr.trim(), MAX_PARSE_STDOUT_BYTES) }),
    }
  }
  if (parsed === null) {
    return {
      error: 'lipi slice вернул не JSON — проверьте установленную версию lipi (нужна 1.0.0 или новее)',
      exitCode,
      ...(out.trim() === '' ? {} : { stdout: truncateText(out.trim(), MAX_PARSE_STDOUT_BYTES) }),
      ...(stderr.trim() === '' ? {} : { stderr: truncateText(stderr.trim(), MAX_PARSE_STDOUT_BYTES) }),
    }
  }
  if (typeof parsed.error === 'string') return errorPayload(parsed, exitCode)
  if (typeof parsed.schema === 'number' && parsed.schema !== 1) {
    return { error: `неподдерживаемая схема среза: ${parsed.schema} (ожидается 1)`, exitCode }
  }
  const missing = missingSuccessFields(parsed)
  if (missing.length > 0) {
    return {
      error: `неожиданный ответ lipi slice: нет обязательных полей ${missing.join(', ')}`,
      exitCode,
      stdout: truncateText(out.trim(), MAX_PARSE_STDOUT_BYTES),
    }
  }
  return sliceSuccess(parsed, exitCode)
}

/**
 * Build the success result: structured fields plus rendered text.
 * @param {object} parsed Parsed slice JSON with the required fields.
 * @param {number} exitCode Process exit code.
 * @returns {object} Slice result with `text`.
 */
function sliceSuccess(parsed, exitCode) {
  const target = parsed.target
  const summary = isPlainObject(parsed.summary) ? parsed.summary : {}
  const blocks = (Array.isArray(parsed.blocks) ? parsed.blocks : []).filter(isPlainObject).map(normalizeBlock)
  const notes = Array.isArray(parsed.notes) ? parsed.notes.filter(isPlainObject) : []
  const result = {
    schema: parsed.schema,
    exitCode,
    target,
    summary,
    blocks,
    incomplete: parsed.incomplete === true,
    notes,
  }
  if (isPlainObject(parsed.checks)) result.checks = parsed.checks
  result.text = renderText(result)
  return result
}

/**
 * Normalize one block so rendering never depends on optional fields.
 * Unknown block keys are preserved.
 * @param {object} block Raw block.
 * @returns {{kind: string, items: object[], omitted: number, hint: string[]} & object} Normalized block.
 */
function normalizeBlock(block) {
  return {
    ...block,
    kind: typeof block.kind === 'string' && block.kind !== '' ? block.kind : 'блок',
    items: Array.isArray(block.items) ? block.items.filter((item) => item !== null && typeof item === 'object') : [],
    omitted: Number.isInteger(block.omitted) && block.omitted > 0 ? block.omitted : 0,
    hint: Array.isArray(block.hint) ? block.hint.filter((hint) => typeof hint === 'string' && hint !== '') : [],
  }
}

/**
 * Render the human-readable slice text.
 * @param {{target: object, summary: object, blocks: object[], incomplete: boolean, notes: object[]}} result Success result.
 * @returns {string} Text for the model.
 */
function renderText(result) {
  const lines = [targetLine(result.target)]
  const summary = summaryLine(result.summary)
  if (summary !== '') lines.push(summary)
  for (const note of result.notes) {
    if (typeof note.text === 'string' && note.text !== '') lines.push(note.text)
  }
  let firstBlock = true
  for (const block of result.blocks) {
    if (block.items.length === 0 && block.omitted === 0) continue
    if (firstBlock) {
      lines.push('')
      firstBlock = false
    }
    lines.push(BLOCK_TITLES[block.kind] ?? block.kind)
    for (const item of block.items) {
      if (block.kind === 'excerpt') {
        for (const line of excerptLines(item)) lines.push('  ' + line)
        continue
      }
      lines.push('  ' + itemLine(block.kind, item))
    }
    if (block.omitted > 0) lines.push('  ' + omittedLine(block, result.target))
  }
  if (result.incomplete === true) lines.push('неполно: часть сведений скрыта или проверена не полностью')
  return lines.join('\n')
}

/**
 * The first line of the answer: target, title, and the target's attributes.
 * @param {object} target JSON `target` object.
 * @returns {string} Target line.
 */
function targetLine(target) {
  const name = typeof target.target === 'string' && target.target !== '' ? target.target : '(цель)'
  const title = typeof target.title === 'string' && target.title !== '' ? target.title : ''
  const parts = []
  if (typeof target.kind === 'string' && target.kind !== '') parts.push(target.kind)
  if (typeof target.found === 'string' && target.found !== '') {
    parts.push(target.found === 'exact' ? 'exact' : `найдено: ${target.found}`)
  }
  if (typeof target.layer === 'string' && target.layer !== '') parts.push(`слой: ${target.layer}`)
  if (typeof target.status === 'string' && target.status !== '') parts.push(target.status)
  let line = title === '' ? name : `${name} — ${title}`
  if (parts.length > 0) line += ` [${parts.join(', ')}]`
  return line
}

/**
 * Render the non-zero parts of the summary with Russian plural forms.
 * @param {object} summary JSON `summary` object.
 * @returns {string} Summary line, or an empty string when every part is zero.
 */
function summaryLine(summary) {
  const parts = []
  for (const [key, one, few, many] of SUMMARY_PARTS) {
    const number = summary[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) continue
    let part = countText(number, one, few, many)
    if (key === 'code') {
      const layers = summary.layers
      if (typeof layers === 'number' && Number.isFinite(layers) && layers > 0) {
        part += ` (${countText(layers, 'слой', 'слоя', 'слоёв')})`
      }
    }
    parts.push(part)
  }
  return parts.join(' · ')
}

/**
 * Russian plural agreement for a whole number.
 * @param {number} number Count.
 * @param {string} one Form for 1, 21, …
 * @param {string} few Form for 2–4, 22–24, …
 * @param {string} many Form for 0, 5–20, 25–30, …
 * @returns {string} For example `2 места в коде`.
 */
function countText(number, one, few, many) {
  const word = number % 100 >= 11 && number % 100 <= 14
    ? many
    : number % 10 === 1
      ? one
      : number % 10 >= 2 && number % 10 <= 4
        ? few
        : many
  return `${number} ${word}`
}

/**
 * Render one item outside the excerpt block.
 * @param {string} kind Block kind.
 * @param {object} item Item object.
 * @returns {string} One item line.
 */
function itemLine(kind, item) {
  if (kind === 'signals') return signalLine(item)
  if (kind === 'entry' || kind === 'code' || kind === 'tests') return placeLine(kind, item)
  if (kind === 'obey' || kind === 'concepts' || kind === 'targets' || kind === 'context') return documentLine(kind, item)
  return genericLine(item)
}

/**
 * Render one signal item: `! A4  path:line — message` or `· message`.
 * @param {object} item Signal item.
 * @returns {string} Signal line.
 */
function signalLine(item) {
  const message = typeof item.message === 'string' ? item.message : ''
  const code = typeof item.code === 'string' && item.code !== '' ? item.code : ''
  if (code === '') return '· ' + message
  let line = `! ${code}  `
  if (typeof item.path === 'string' && item.path !== '') {
    line += item.path
    if (Number.isInteger(item.line) && item.line > 0) line += `:${item.line}`
    line += ' — '
  }
  return line + message
}

/**
 * Render one code place item: `path:line  symbol  [layer]`; tests carry no layer.
 * @param {string} kind `entry`, `code`, or `tests`.
 * @param {object} item Place item.
 * @returns {string} Place line.
 */
function placeLine(kind, item) {
  const path = typeof item.path === 'string' ? item.path : ''
  const line = Number.isInteger(item.line) && item.line > 0 ? `:${item.line}` : ''
  const symbol = typeof item.symbol === 'string' ? item.symbol : ''
  let text = `${path}${line}  ${symbol}`
  if (kind !== 'tests') {
    const layer = typeof item.layer === 'string' ? item.layer : ''
    if (layer !== '') text += `  [${layer}]`
  }
  return text
}

/**
 * Render one document item (decision, concept, work target, neighbour).
 * @param {string} kind `obey`, `concepts`, `targets`, or `context`.
 * @param {object} item Document item.
 * @returns {string} Document line.
 */
function documentLine(kind, item) {
  let text = typeof item.target === 'string' ? item.target : ''
  if (kind === 'obey' && typeof item.status === 'string' && item.status !== '') text += ' ' + item.status
  if (typeof item.title === 'string' && item.title !== '') text += ` — ${item.title}`
  if (kind === 'obey' && typeof item.relation === 'string' && item.relation !== '') text += ` (${item.relation})`
  if (kind === 'concepts' || kind === 'targets') {
    if (Number.isInteger(item.code_count) && item.code_count >= 0) {
      text += ` (${countText(item.code_count, 'место в коде', 'места в коде', 'мест в коде')})`
    }
  }
  return text
}

/**
 * Render an item of a block kind this version does not know, tolerating new shapes.
 * @param {object} item Item object.
 * @returns {string} Best-effort item line.
 */
function genericLine(item) {
  if (typeof item.path === 'string') return placeLine('code', item)
  if (typeof item.target === 'string') return documentLine('context', item)
  if (typeof item.text === 'string') return item.text
  if (typeof item.message === 'string') return item.message
  const fields = Object.entries(item).map(([key, value]) => `${key}=${scalarText(value)}`)
  return fields.join('  ')
}

/**
 * Lines of one excerpt item.
 * @param {object} item Excerpt item with a `text` field.
 * @returns {string[]} Excerpt lines.
 */
function excerptLines(item) {
  return typeof item.text === 'string' ? item.text.split('\n') : []
}

/**
 * The trailing line of a block whose items were cut by the response budget.
 * @param {{kind: string, items: object[], omitted: number, hint: string[]}} block Block with `omitted > 0`.
 * @param {object} target JSON `target` object.
 * @returns {string} Omission line with the flags that show the hidden part.
 */
function omittedLine(block, target) {
  const hints = block.hint.length > 0 ? `; ещё — ${block.hint.join(', ')}` : ''
  if (block.kind === 'excerpt') {
    const shown = block.items.reduce((sum, item) => sum + excerptLineCount(item), 0)
    return `обрезано; показано ${shown} из ${shown + block.omitted} строк${hints}`
  }
  if (block.kind === 'concepts' && target.kind === 'code') {
    return `реализует ещё ${countText(block.omitted, 'понятие', 'понятия', 'понятий')}${hints}`
  }
  const shown = block.items.length
  const unit = block.kind === 'signals' ? ' сигналов' : ''
  return `показано ${shown} из ${shown + block.omitted}${unit}${hints}`
}

/**
 * Number of lines one excerpt item has.
 * @param {object} item Excerpt item.
 * @returns {number} Line count.
 */
function excerptLineCount(item) {
  if (Number.isInteger(item.lines) && item.lines >= 0) return item.lines
  return typeof item.text === 'string' && item.text !== '' ? item.text.split('\n').length : 0
}

/**
 * Build the code-2 result: bad arguments or settings.
 * @param {object | null} parsed Parsed stdout, if it was JSON.
 * @param {string} stderr Standard error of the command.
 * @param {string} stdout Standard output of the command.
 * @returns {object} Error result with the required message and a detail.
 */
function commandError(parsed, stderr, stdout) {
  const detail = commandDetail(parsed, stderr, stdout)
  return {
    error: 'неверные аргументы или настройки',
    exitCode: 2,
    ...(detail === '' ? {} : { details: detail }),
  }
}

/**
 * Extract the useful part of a code-2 failure: a C1 finding from the check
 * report, the error field of some JSON, or the last error line of stderr.
 * @param {object | null} parsed Parsed stdout, if it was JSON.
 * @param {string} stderr Standard error of the command.
 * @param {string} stdout Standard output of the command.
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
  const source = stderr.trim() !== '' ? stderr : stdout
  const lines = source.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const withError = lines.filter((line) => /error:|ошибк/i.test(line))
  const detail = withError.length > 0 ? withError[withError.length - 1] : lines[lines.length - 1]
  return detail === undefined ? '' : truncateText(detail, MAX_PARSE_STDOUT_BYTES)
}

/**
 * Build the code-1 result: the target was not found or is ambiguous.
 * @param {object | null} parsed Parsed stdout, if it was JSON.
 * @param {string} stdout Standard output of the command.
 * @returns {object} Error result with candidates.
 */
function targetError(parsed, stdout) {
  if (isPlainObject(parsed) && typeof parsed.error === 'string') return errorPayload(parsed, 1)
  const fromText = parseTextError(stdout)
  if (fromText !== null) return { ...fromText, exitCode: 1 }
  return {
    error: 'цель не найдена',
    exitCode: 1,
    ...(stdout.trim() === '' ? {} : { details: truncateText(stdout.trim(), MAX_PARSE_STDOUT_BYTES) }),
  }
}

/**
 * Turn the command's own JSON error document into an error result.
 * @param {object} parsed JSON with `error`, `query`, and `candidates`.
 * @param {number} exitCode Process exit code.
 * @returns {{error: string, exitCode: number, query: string, candidates: Array<{target: string, title: string}>}} Error result.
 */
function errorPayload(parsed, exitCode) {
  const query = typeof parsed.query === 'string' ? parsed.query : ''
  const reason = parsed.error === 'ambiguous' ? 'неоднозначна' : 'не найдена'
  const unknown = parsed.error !== 'ambiguous' && parsed.error !== 'not-found' ? ` (${parsed.error})` : ''
  return {
    error: `цель${query === '' ? '' : ` «${query}»`} ${reason}${unknown}`,
    exitCode,
    query,
    candidates: normalizeCandidates(parsed.candidates),
  }
}

/**
 * Read the plain-text error form the command prints in text mode.
 * @param {string} stdout Standard output with `цель «…» не найдена` or `… неоднозначна; кандидаты:`.
 * @returns {{error: string, query: string, candidates: Array<{target: string, title: string}>} | null} Parsed error, or null.
 */
function parseTextError(stdout) {
  const header = /^цель «(.+?)» (не найдена|неоднозначна)(?:; кандидаты:)?\s*$/m.exec(stdout)
  if (header === null) return null
  const query = header[1]
  const ambiguous = header[2] === 'неоднозначна'
  const candidates = []
  for (const line of stdout.split('\n')) {
    const match = /^ {2}(.+?) — (.+?)\s*$/.exec(line)
    if (match !== null) candidates.push({ target: match[1], title: match[2] })
  }
  return {
    error: `цель «${query}» ${ambiguous ? 'неоднозначна' : 'не найдена'}`,
    query,
    candidates: ambiguous || candidates.length > 0 ? candidates : [],
  }
}

/**
 * Keep only the target/title of each candidate, tolerating new keys there.
 * @param {unknown} candidates Raw `candidates` value.
 * @returns {Array<{target: string, title: string}>} Normalized candidates.
 */
function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates)) return []
  return candidates
    .filter((candidate) => candidate !== null && typeof candidate === 'object')
    .map((candidate) => ({
      target: typeof candidate.target === 'string' ? candidate.target : '',
      title: typeof candidate.title === 'string' ? candidate.title : '',
    }))
}

/**
 * List the top-level fields a successful answer must carry.
 * @param {object} parsed Parsed stdout.
 * @returns {string[]} Names of absent or malformed fields.
 */
function missingSuccessFields(parsed) {
  const missing = []
  if (typeof parsed.schema !== 'number') missing.push('schema')
  if (!isPlainObject(parsed.target)) missing.push('target')
  else if (typeof parsed.target.target !== 'string' || parsed.target.target === '') missing.push('target.target')
  if (!isPlainObject(parsed.summary)) missing.push('summary')
  if (!Array.isArray(parsed.blocks)) missing.push('blocks')
  return missing
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
 * Keep the non-empty string entries of an optional list flag.
 * @param {unknown} value String, array of strings, or nothing.
 * @returns {string[]} Trimmed non-empty strings.
 */
function nonEmptyStrings(value) {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return raw
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/**
 * Render a scalar for the fallback item line.
 * @param {unknown} value Any field value.
 * @returns {string} Text form.
 */
function scalarText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
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
