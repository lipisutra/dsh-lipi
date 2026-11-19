/**
 * `lipi_new`: create a project working document through the installed
 * `lipi new` command.
 * @module @lipisutra/dsh-lipi/tools/new
 */
import { resolveProject } from '../project.js'
import { runCheck } from '../runner.js'

/** Document types `lipi new` can create. */
export const NEW_TYPES = ['pln', 'iss', 'dsc', 'adr', 'aud']

/** Issue kinds accepted for `iss`. */
export const ISSUE_KINDS = ['баг', 'трение', 'запрос', 'вопрос']

const NEW_DESCRIPTION = [
  'Создаёт новый рабочий документ проекта по правилам lipi через установленную команду',
  '`lipi new`: plan (pln), issue (iss), обсуждение (dsc), решение (adr) или аудит (aud).',
  'Документ получает очередной номер, а указатель рабочих материалов обновляется.',
  'Возвращает path созданного файла, его id и index_updated — признак обновления указателя;',
  'при ошибке возвращает error и exitCode. Нужны установленная команда lipi',
  '(`pipx install git+https://github.com/lipisutra/lipi`) и проект, развёрнутый по lipi.',
].join(' ')

const NEW_PARAMETERS = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['pln', 'iss', 'dsc', 'adr', 'aud'],
      description: 'Тип документа: pln — план, iss — замечание, dsc — обсуждение, adr — решение, aud — аудит.',
    },
    title: {
      type: 'string',
      description: 'Название документа человеческим языком; из него строится имя файла и заголовок.',
    },
    kind: {
      type: 'string',
      enum: ['баг', 'трение', 'запрос', 'вопрос'],
      description: 'Вид замечания. Учитывается только при type=iss; без него lipi выбирает вид по умолчанию.',
    },
    path: {
      type: 'string',
      description: 'Корень проекта. По умолчанию — рабочая папка сессии; укажите путь, если она не внутри проекта или сервис рабочей папки недоступен.',
    },
  },
  required: ['type', 'title'],
}

const RESULT_SCHEMA = { type: 'object', additionalProperties: true }

/**
 * Create the `lipi_new` tool definition for one plugin context.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context; the working-directory service is read through `ctx.get`.
 * @param {{lipiPath: string, wslDistro: string, maxItems: number, minLipi?: string}} cfg Valid bundle configuration.
 * @returns {object} A registry-ready tool definition.
 */
export function createNewTool(ctx, cfg) {
  return {
    name: 'lipi_new',
    description: NEW_DESCRIPTION,
    parameters: NEW_PARAMETERS,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    /**
     * @param {{type: string, title: string, kind?: string, path?: string}} args Validated arguments.
     * @param {{agent?: {session: object}}} exec Execution context.
     * @returns {Promise<object>} Created document reference or an error result.
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
        result = runCheck(project, newArguments(args), cfg)
      } catch (error) {
        return withHint({ error: messageOf(error) }, cfg)
      }
      if (result.code === 0) {
        const parsed = parseNewResult(result.stdout)
        if (parsed !== null) return { ...parsed, exitCode: result.code }
        return withHint({
          error: result.stdout.trim() || result.stderr.trim() || 'lipi завершился без вывода',
          exitCode: result.code,
        }, cfg)
      }
      return withHint({
        error: result.stderr.trim() || result.stdout.trim(),
        exitCode: result.code,
      }, cfg)
    },
  }
}

/**
 * Turn validated arguments into installed lipi command arguments. The format
 * flag stays after `new`: the CLI only passes the arguments that follow the
 * subcommand to the checker, and the checker extracts `--format` from them, so
 * at CLI level it cannot stand before `new`.
 * @param {{type: string, title: string, kind?: string}} args Tool arguments.
 * @returns {string[]} `lipi` command arguments.
 */
export function newArguments(args) {
  const commandArgs = ['new', args.type, args.title]
  if (args.type === 'iss' && typeof args.kind === 'string' && args.kind !== '') {
    commandArgs.push(args.kind)
  }
  commandArgs.push('--format', 'json')
  return commandArgs
}

/**
 * Read the `lipi new` success output. The command emits JSON when `--format
 * json` reaches the `new` subcommand; when it prints its human line instead,
 * accept that form as well so a successful creation is not reported as an
 * error.
 * @param {string} stdout `lipi new` standard output.
 * @returns {{path: string, id: string, index_updated: boolean} | null} Document reference, or null when unreadable.
 */
export function parseNewResult(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof parsed.path === 'string' && typeof parsed.id === 'string') {
      return { path: parsed.path, id: parsed.id, index_updated: parsed.index_updated === true }
    }
  } catch {
    // fall through to the plain-text form
  }
  const match = /^создан\s+(.+?)\s+\(([A-Z]+-\d+)\),\s*указатель обновлён/m.exec(stdout)
  if (match === null) return null
  return { path: match[1], id: match[2], index_updated: true }
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
 * Render an unknown thrown value as text.
 * @param {unknown} error Thrown value.
 * @returns {string} Its message or string form.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
