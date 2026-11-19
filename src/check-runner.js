/**
 * Reusable host operations: run the installed `lipi` command in a project and
 * parse its result. Shared by the `lipi_check` tool and the Client status
 * widget; the `/lipi-check`, `/lipi-slice`, `/lipi-init`, `/lipi-doctor` and
 * `/lipi-map` commands share project resolution, the child-process launch, and
 * the missing-command error below. `/lipi-lang` reads the personal interface
 * language of the installed lipi through the Python from its shebang.
 * @module @lipisutra/dsh-lipi/check-runner
 */
import { spawnSync } from 'node:child_process'
import { accessSync, closeSync, constants, existsSync, openSync, readSync, statSync } from 'node:fs'
import { basename, delimiter, join, resolve } from 'node:path'

import { ProjectNotDeployedError, resolveProject } from './project.js'
import { lipiCommand, runCheck, runInstalled } from './runner.js'
import { parseCheckResult } from './tools/check.js'
import { mapArguments, parseMapResult } from './tools/map.js'
import { SLICE_DEPTHS, sliceArguments } from './tools/slice.js'
import { isOlder } from './semver.js'

/** Maximum number of candidates named in a `lipi slice` error answer. */
const MAX_SLICE_CANDIDATES = 5

/** Number of trailing output lines kept for a successful `lipi init` answer. */
const INIT_TAIL_LINES = 20

/** Usage reminder for the slice command. */
const SLICE_USAGE = '/lipi-slice <путь> <цель> [--full] [--depth 2|3] [--layer X] [--only Y]'

/** Probe script that prints the installed lipi language settings as JSON. */
const LANGUAGE_PROBE = "import lipi.i18n as i; import json; print(json.dumps({'available': i.available_languages(), 'current': i.current_language()}))"

/** Answer used when the installed lipi settings cannot be read. */
const FALLBACK_LANGUAGE = Object.freeze({ current: 'en', available: Object.freeze(['en']) })

/** Cooperative limit for one language probe. */
const LANGUAGE_TIMEOUT_MS = 15_000


/**
 * Run `lipi check` for one project root and return a bounded JSON result.
 * @param {string} root Directory to start project discovery from.
 * @param {{lipiPath: string, wslDistro: string, maxItems: number, minLipi?: string}} cfg Bundle configuration.
 * @param {'quick' | 'staged' | 'audit'} [mode] Check mode.
 * @returns {object} Parsed result: `errors`, `warnings`, `summary`, `exitCode`, plus `parseError` on non-JSON output.
 * @throws {import('./project.js').ProjectNotDeployedError} When no lipi project is found.
 * @throws {Error} When the installed `lipi` command is missing.
 */
export function checkProject(root, cfg, mode = 'quick') {
  const args = mode === 'staged' ? ['check', '--format', 'json', '--staged']
    : mode === 'audit' ? ['check', '--format', 'json', '--audit']
      : ['check', '--format', 'json']
  const project = resolveProject(root)
  const result = runCheck(project, args, cfg)
  const parsed = parseCheckResult(result.stdout, {
    root: project.root,
    exitCode: result.code,
    maxItems: cfg.maxItems,
    stderr: result.stderr,
  })
  if (parsed.parseError !== true && typeof cfg?.minLipi === 'string' && isOlder(parsed.version, cfg.minLipi)) {
    parsed.minLipiHint = `установленный lipi ${parsed.version} старше поддерживаемого минимума ${cfg.minLipi} — обновите: pipx upgrade lipi`
  }
  return parsed
}

/**
 * Split a `/lipi-check` command line into a project path and a check mode.
 * Modes: `--staged`/`staged` and `--audit`/`audit`; anything else means quick.
 * @param {string} rawInput Text after the command name.
 * @returns {{path: string, mode: 'quick' | 'staged' | 'audit'}} Parsed line.
 */
export function parseCheckLine(rawInput) {
  const tokens = String(rawInput ?? '').trim().split(/\s+/).filter((token) => token !== '')
  const modeToken = tokens.length > 1 ? tokens[tokens.length - 1] : ''
  const mode = modeToken === '--staged' || modeToken === 'staged' ? 'staged'
    : modeToken === '--audit' || modeToken === 'audit' ? 'audit'
      : 'quick'
  const path = mode === 'quick' ? tokens.join(' ') : tokens.slice(0, -1).join(' ')
  return { path, mode }
}

/**
 * Command handler for the Client status widget: run a check on a path given as
 * command input and return the result as a JSON command result.
 * @param {string} rawInput Text after the command name, i.e. the project path and an optional mode.
 * @param {{lipiPath: string, wslDistro: string, maxItems: number, minLipi?: string}} cfg Bundle configuration.
 * @returns {{kind: 'success', text: string} | {kind: 'error', text: string}} A command result.
 */
export function runLipiCheck(rawInput, cfg) {
  const { path, mode } = parseCheckLine(rawInput)
  if (!path) {
    return errorResult('укажите папку проекта: /lipi-check /путь/к/проекту [--staged|--audit]')
  }
  try {
    const result = checkProject(path, cfg, mode)
    if (result.parseError === true) return errorResult(nonJsonMessage(result.stderr))
    return successResult(JSON.stringify(result))
  } catch (error) {
    return errorResult(messageOf(error))
  }
}

/**
 * Split a `/lipi-slice` command line into a project path, a slice target, and
 * flags. Double quotes protect spaces: the path is the first positional token
 * and the target is every remaining positional token joined by one space.
 * Flags may stand anywhere and are removed from the positional tokens.
 * @param {string} rawInput Text after the command name.
 * @returns {{path: string, target: string, flags: {full: boolean, depth: number | undefined, layer: string[], only: string | undefined}}} Parsed line.
 * @throws {Error} On an unknown flag, a flag without a value, or a depth other than 2 or 3.
 */
export function parseSliceLine(rawInput) {
  const tokens = tokenizeLine(rawInput)
  const positionals = []
  const flags = { full: false, depth: undefined, layer: [], only: undefined, staged: false, diff: undefined }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--full') {
      flags.full = true
      continue
    }
    if (token === '--staged') {
      flags.staged = true
      continue
    }
    if (token === '--diff') {
      const value = tokens[index + 1]
      if (value === undefined || value.trim() === '') throw new Error('флаг --diff требует значение (диапазон git)')
      index += 1
      flags.diff = value
      continue
    }
    if (token === '--depth' || token === '--layer' || token === '--only') {
      const value = tokens[index + 1]
      if (value === undefined || value.trim() === '') throw new Error(`флаг ${token} требует значение`)
      index += 1
      if (token === '--depth') {
        const depth = Number(value)
        if (!SLICE_DEPTHS.includes(depth)) throw new Error(`глубина среза — 2 или 3, получено «${value}»`)
        flags.depth = depth
      } else if (token === '--layer') {
        for (const layer of splitList(value)) flags.layer.push(layer)
      } else {
        flags.only = value
      }
      continue
    }
    if (token.startsWith('--')) throw new Error(`неизвестный флаг среза: «${token}»`)
    positionals.push(token)
  }
  const [path = '', ...targetParts] = positionals
  return { path, target: targetParts.join(' '), flags }
}

/**
 * Command handler for `/lipi-slice`: run `lipi slice <target> --format json`
 * in the project and return the parsed JSON answer.
 * @param {string} rawInput Text after the command name: project path, target, and optional flags.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {{kind: 'success', text: string} | {kind: 'error', text: string}} A command result.
 */
export function runSliceCommand(rawInput, cfg) {
  let line
  try {
    line = parseSliceLine(rawInput)
  } catch (error) {
    return errorResult(messageOf(error))
  }
  if (line.path === '') return errorResult(`укажите папку проекта: ${SLICE_USAGE}`)
  if (line.target === '' && line.flags.staged !== true && line.flags.diff === undefined) {
    return errorResult(`укажите цель среза или --staged/--diff: ${SLICE_USAGE}`)
  }
  let args
  try {
    args = sliceArguments(line.target, line.flags)
  } catch (error) {
    return errorResult(messageOf(error))
  }
  const launched = launchIn(line.path, args, cfg)
  if (launched.error !== undefined) return errorResult(launched.error)
  return parseSliceOutput(launched.result.stdout, launched.result.code, launched.result.stderr)
}

/**
 * Command handler for `/lipi-init`: run `lipi init` in the project directory.
 * A directory that is not a lipi project yet is initialized itself, while a
 * path inside a deployed project maps to that project's root.
 * @param {string} rawInput Text after the command name: the project path.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {{kind: 'success', text: string} | {kind: 'error', text: string}} A command result.
 */
export function parseInitLine(rawInput) {
  const tokens = tokenizeLine(rawInput)
  const dryRun = tokens.length > 0 && tokens[tokens.length - 1] === '--dry-run'
  const path = (dryRun ? tokens.slice(0, -1) : tokens).join(' ')
  return { path, dryRun }
}

export function runInitCommand(rawInput, cfg) {
  const { path, dryRun } = parseInitLine(rawInput)
  if (path === '') return errorResult('укажите папку проекта: /lipi-init /путь/к/проекту [--dry-run]')
  const launched = launchIn(path, dryRun ? ['init', '--dry-run'] : ['init'], cfg, true)
  if (launched.error !== undefined) return errorResult(launched.error)
  const output = commandOutput(launched.result.stdout, launched.result.stderr)
  if (launched.result.code !== 0) {
    const text = output.replace(/\s+$/, '')
    return errorResult(text === '' ? `lipi init завершился с кодом ${launched.result.code} без вывода` : text)
  }
  return successResult(tailLines(output, INIT_TAIL_LINES))
}

/**
 * Command handler for `/lipi-doctor`: run `lipi doctor` in the project
 * directory. Problems found by the command (exit code 1) are its output, not
 * a failed command, so the answer stays successful.
 * @param {string} rawInput Text after the command name: the project path.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {{kind: 'success', text: string} | {kind: 'error', text: string}} A command result.
 */
export function runDoctorCommand(rawInput, cfg) {
  const path = parseProjectPath(rawInput)
  if (path === '') return errorResult('укажите папку проекта: /lipi-doctor /путь/к/проекту')
  const launched = launchIn(path, ['doctor'], cfg, true)
  if (launched.error !== undefined) return errorResult(launched.error)
  return successResult(commandOutput(launched.result.stdout, launched.result.stderr))
}

/**
 * Command handler for `/lipi-map`: run `lipi map --format json` in the project
 * and return the parsed answer, including its human-readable `text`.
 * @param {string} rawInput Text after the command name: the project path.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {{kind: 'success', text: string} | {kind: 'error', text: string}} A command result.
 */
export function runMapCommand(rawInput, cfg) {
  const path = parseProjectPath(rawInput)
  if (path === '') return errorResult('укажите папку проекта: /lipi-map /путь/к/проекту')
  const launched = launchIn(path, mapArguments(), cfg)
  if (launched.error !== undefined) return errorResult(launched.error)
  const parsed = parseMapResult(launched.result.stdout, launched.result.code, { stderr: launched.result.stderr })
  if (parsed.error !== undefined) {
    return errorResult(typeof parsed.details === 'string' && parsed.details !== ''
      ? `${parsed.error}: ${parsed.details}`
      : parsed.error)
  }
  return successResult(JSON.stringify(parsed))
}

/**
 * Split a `/lipi-lang` command line into the requested language code.
 * The interface language is personal, so the command takes no project path.
 * @param {string} rawInput Text after the command name: nothing or one code.
 * @returns {{lang: string}} The language code, or an empty string for a pure read.
 * @throws {Error} When more than one token is given.
 */
export function parseLangLine(rawInput) {
  const tokens = tokenizeLine(rawInput)
  if (tokens.length > 1) throw new Error('формат: /lipi-lang [ru|en] — не больше одного кода языка')
  return { lang: tokens[0] ?? '' }
}

/**
 * Command handler for `/lipi-lang`: without an argument read the current and
 * available interface languages of the installed lipi; with a code first run
 * `lipi lang <код>` and then read them again.
 *
 * The settings are read through the Python from the shebang of the installed
 * lipi command, so the probe uses the very package the command runs. When that
 * is unavailable the answer falls back to `en` with a note.
 * @param {string} rawInput Text after the command name: nothing or one language code.
 * @param {{lipiPath: string}} cfg Bundle configuration.
 * @returns {{kind: 'success', text: string} | {kind: 'error', text: string}} A command result.
 */
export function runLangCommand(rawInput, cfg) {
  let line
  try {
    line = parseLangLine(rawInput)
  } catch (error) {
    return errorResult(messageOf(error))
  }
  if (line.lang !== '') {
    let changed
    try {
      changed = runInstalled(['lang', line.lang], cfg)
    } catch (error) {
      return errorResult(messageOf(error))
    }
    if (changed.code !== 0) {
      const detail = lastLine(changed.stderr) || lastLine(changed.stdout)
      return errorResult(`lipi lang ${line.lang} завершился с кодом ${changed.code}${detail === '' ? '' : ': ' + detail}`)
    }
  }
  const settings = readLanguageSettings(cfg)
  return successResult(JSON.stringify({
    current: settings.current,
    available: [...settings.available],
    ...(settings.note === undefined ? {} : { note: settings.note }),
  }))
}

/**
 * Read the current and available interface languages of the installed lipi.
 * The Python interpreter is taken from the shebang of the installed command;
 * the probe runs `lipi.i18n` directly, so no project is involved. Any failure
 * yields the `en` fallback with a note instead of throwing.
 * @param {{lipiPath: string}} cfg Bundle configuration.
 * @returns {{current: string, available: string[], note?: string}} Language settings.
 */
function readLanguageSettings(cfg) {
  const command = lipiCommand(cfg)
  const bin = findCommandFile(command)
  if (bin === null) {
    return fallbackLanguage(`команда lipi не найдена: «${command}» — показан язык по умолчанию`)
  }
  const python = findPython(bin)
  if (python === null) {
    return fallbackLanguage(`не удалось определить Python по shebang «${bin}» — показан язык по умолчанию`)
  }
  const result = spawnSync(python, ['-c', LANGUAGE_PROBE], {
    encoding: 'utf8',
    timeout: LANGUAGE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
  if (result.error !== undefined) {
    return fallbackLanguage(`не удалось выполнить Python «${python}»: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim() || `код возврата ${result.status}`
    return fallbackLanguage(`Python «${python}» не прочитал настройки lipi: ${detail}`)
  }
  const settings = readLanguageAnswer(result.stdout)
  if (settings === null) {
    return fallbackLanguage(`Python «${python}» вернул неожиданный ответ — показан язык по умолчанию`)
  }
  return settings
}

/**
 * Parse the probe answer and normalize it.
 * @param {string} text Probe standard output.
 * @returns {{current: string, available: string[]} | null} Language settings, or null when malformed.
 */
function readLanguageAnswer(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (!Array.isArray(parsed.available)) return null
  const available = parsed.available.filter((code) => typeof code === 'string' && code !== '')
  if (available.length === 0) return null
  const current = typeof parsed.current === 'string' && available.includes(parsed.current)
    ? parsed.current
    : available.includes('en') ? 'en' : available[0]
  return { current, available }
}

/**
 * The `en` fallback answer with an explanation.
 * @param {string} note Why the installed settings were not read.
 * @returns {{current: string, available: string[], note: string}} Fallback settings.
 */
function fallbackLanguage(note) {
  return { current: FALLBACK_LANGUAGE.current, available: [...FALLBACK_LANGUAGE.available], note }
}

/**
 * Resolve the executable file of a command name or path, using PATH for a bare
 * name. The shebang of that file names the Python that owns the installed lipi.
 * @param {string} command Command name or path.
 * @returns {string | null} Executable file, or null when it cannot be found.
 */
function findCommandFile(command) {
  if (typeof command !== 'string' || command === '') return null
  if (command.includes('/') || command.includes('\\')) {
    const absolute = resolve(command)
    return isExecutableFile(absolute) ? absolute : null
  }
  const path = typeof process.env.PATH === 'string' ? process.env.PATH : ''
  const names = process.platform === 'win32'
    ? [command, `${command}.exe`, `${command}.cmd`]
    : [command]
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue
    for (const name of names) {
      const candidate = join(directory, name)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * Find the Python interpreter named by the shebang of the installed command.
 * Understands `#!/path/python -E` and `#!/usr/bin/env python3`.
 * @param {string} bin Installed command file.
 * @returns {string | null} Python path, or null when the shebang does not name one.
 */
function findPython(bin) {
  let line
  try {
    line = readFirstLine(bin)
  } catch {
    return null
  }
  if (!line.startsWith('#!')) return null
  const words = line.slice(2).trim().split(/\s+/).filter(Boolean)
  let command = words.shift()
  if (basename(command ?? '') === 'env') {
    while (words.length > 0 && words[0].startsWith('-')) words.shift()
    command = words.shift()
  }
  if (command === undefined) return null
  return resolveInterpreter(command)
}

/**
 * Read the first line of a text file (the shebang).
 * @param {string} path File path.
 * @returns {string} First line without a line break.
 */
function readFirstLine(path) {
  const descriptor = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024)
    const size = readSync(descriptor, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, size).toString('utf8').split('\n')[0].replace(/\r$/, '')
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Resolve an interpreter name from a shebang to an executable path.
 * @param {string} command Interpreter name or path.
 * @returns {string | null} Executable path, or null when it is not found.
 */
function resolveInterpreter(command) {
  if (command.includes('/') || command.includes('\\')) {
    const absolute = resolve(command)
    return isExecutableFile(absolute) ? absolute : null
  }
  const path = typeof process.env.PATH === 'string' ? process.env.PATH : ''
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue
    for (const suffix of suffixes) {
      const candidate = join(directory, command + suffix)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * Whether a path is an executable file.
 * @param {string} path Path to test.
 * @returns {boolean} Exists, is a file, and is executable.
 */
function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Read the project directory of `/lipi-init` or `/lipi-doctor`; every
 * positional token belongs to the path, so a quoted path with spaces survives.
 * @param {string} rawInput Text after the command name.
 * @returns {string} The path, or an empty string when none was given.
 */
function parseProjectPath(rawInput) {
  return tokenizeLine(rawInput).join(' ')
}

/**
 * Split a command line into tokens, honoring double quotes and backslash
 * escapes inside them (`\\"` and `\\\\`). An unterminated quote keeps the rest
 * of the line in the token instead of failing.
 * @param {string} rawInput Command input.
 * @returns {string[]} Tokens without quotes.
 */
function tokenizeLine(rawInput) {
  const text = String(rawInput ?? '')
  const tokens = []
  let current = ''
  let started = false
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '\\' && index + 1 < text.length) {
        index += 1
        current += text[index]
      } else if (character === '"') {
        quoted = false
      } else {
        current += character
      }
      continue
    }
    if (character === '"') {
      quoted = true
      started = true
    } else if (/\s/.test(character)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
    } else {
      current += character
      started = true
    }
  }
  if (started) tokens.push(current)
  return tokens
}

/**
 * Split a comma-separated flag value into trimmed non-empty parts.
 * @param {string} value Flag value.
 * @returns {string[]} Non-empty entries.
 */
function splitList(value) {
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
}

/**
 * Run the installed command in the resolved project root. `allowUndeployed`
 * keeps `lipi init` and `lipi doctor` usable in a folder that is not a lipi
 * project yet: that folder itself becomes the root.
 * @param {string} path Directory given on the command line.
 * @param {string[]} args Command arguments.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @param {boolean} [allowUndeployed] Fall back to `path` when it is not a deployed project.
 * @returns {{result: {code: number, stdout: string, stderr: string}} | {error: string}} Launch outcome.
 */
function launchIn(path, args, cfg, allowUndeployed = false) {
  let root
  try {
    root = allowUndeployed ? commandRoot(path) : resolveProject(path).root
  } catch (error) {
    return { error: messageOf(error) }
  }
  try {
    return { result: runCheck({ root }, args, cfg) }
  } catch (error) {
    return { error: messageOf(error) }
  }
}

/**
 * Resolve the directory a command outside the check surface runs in: a path
 * inside a deployed project maps to its root, and a path outside any
 * deployment is used as given.
 * @param {string} path Directory given on the command line.
 * @returns {string} Absolute directory to run in.
 * @throws {Error} When the path does not exist and no deployment was found.
 */
function commandRoot(path) {
  try {
    return resolveProject(path).root
  } catch (error) {
    if (!(error instanceof ProjectNotDeployedError)) throw error
    const root = resolve(path)
    if (!existsSync(root)) throw new Error(`папка не найдена: «${root}»`)
    return root
  }
}

/**
 * Parse the JSON output of `lipi slice` into a command result.
 *
 * Exit code 2 means bad arguments or settings, 1 — the target was not found
 * or is ambiguous, 0 — the slice itself. Unknown success fields pass through
 * as the command printed them.
 * @param {string} stdout Command standard output.
 * @param {number} exitCode Command exit code.
 * @param {string} stderr Command standard error.
 * @returns {{kind: 'success', text: string} | {kind: 'error', text: string}} A command result.
 */
function parseSliceOutput(stdout, exitCode, stderr) {
  const out = typeof stdout === 'string' ? stdout : ''
  const err = typeof stderr === 'string' ? stderr : ''
  const parsed = parseJsonObject(out)
  if (exitCode === 2) {
    const detail = sliceCommandDetail(parsed, err, out)
    return errorResult(`неверные аргументы или настройки${detail === '' ? '' : ': ' + detail}`)
  }
  if (exitCode === 1) {
    if (parsed !== null && typeof parsed.error === 'string') return errorResult(sliceTargetMessage(parsed))
    if (parsed === null) return errorResult(nonJsonMessage(err))
    return errorResult(`lipi slice завершился с кодом 1${lastLineSuffix(err, out)}`)
  }
  if (exitCode !== 0) {
    return errorResult(`lipi slice завершился с кодом ${exitCode}${lastLineSuffix(err, out)}`)
  }
  if (parsed === null) return errorResult(nonJsonMessage(err))
  return successResult(JSON.stringify(parsed))
}

/**
 * Build the code-1 answer: the target was not found or is ambiguous.
 * @param {object} parsed Parsed JSON with `error`, `query`, and `candidates`.
 * @returns {string} Message naming the query and up to five candidates.
 */
function sliceTargetMessage(parsed) {
  const query = typeof parsed.query === 'string' ? parsed.query : ''
  const reason = parsed.error === 'ambiguous' ? 'неоднозначна' : 'не найдена'
  const candidates = normalizeCandidates(parsed.candidates).slice(0, MAX_SLICE_CANDIDATES)
  const shown = candidates
    .map((candidate) => candidate.title === '' ? candidate.target : `${candidate.target} — ${candidate.title}`)
    .join('; ')
  return `цель «${query}» ${reason}${shown === '' ? '' : ': кандидаты: ' + shown}`
}

/**
 * Keep the target and title of each slice candidate, tolerating other keys.
 * @param {unknown} candidates Raw `candidates` value.
 * @returns {Array<{target: string, title: string}>} Normalized candidates with a target.
 */
function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates)) return []
  return candidates
    .filter((candidate) => isPlainObject(candidate))
    .map((candidate) => ({
      target: typeof candidate.target === 'string' ? candidate.target : '',
      title: typeof candidate.title === 'string' ? candidate.title : '',
    }))
    .filter((candidate) => candidate.target !== '')
}

/**
 * Extract the useful part of a code-2 failure: a check finding, the `error`
 * field of the JSON, or the last non-empty line of stderr or stdout.
 * @param {object | null} parsed Parsed stdout, when it was a JSON object.
 * @param {string} stderr Command standard error.
 * @param {string} stdout Command standard output.
 * @returns {string} Short detail, or an empty string when nothing is readable.
 */
function sliceCommandDetail(parsed, stderr, stdout) {
  if (isPlainObject(parsed) && Array.isArray(parsed.errors)) {
    const first = parsed.errors.find((item) => isPlainObject(item) && typeof item.message === 'string' && item.message !== '')
    if (first !== undefined) return first.message
  }
  if (isPlainObject(parsed) && typeof parsed.error === 'string' && parsed.error !== '') return parsed.error
  return lastLine(stderr) || lastLine(stdout)
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
 * @returns {string} Suffix with a leading colon, or an empty string.
 */
function lastLineSuffix(stderr, stdout) {
  const detail = lastLine(stderr) || lastLine(stdout)
  return detail === '' ? '' : ': ' + detail
}

/**
 * Join command output, appending standard error when both streams printed.
 * @param {string} stdout Command standard output.
 * @param {string} stderr Command standard error.
 * @returns {string} Combined output.
 */
function commandOutput(stdout, stderr) {
  const out = typeof stdout === 'string' ? stdout : ''
  const err = typeof stderr === 'string' ? stderr : ''
  if (out === '') return err
  if (err === '') return out
  return out.endsWith('\n') ? out + err : `${out}\n${err}`
}

/**
 * Keep the trailing lines of a command output.
 * @param {string} text Command output.
 * @param {number} limit Number of lines to keep.
 * @returns {string} The last `limit` lines, without a trailing line break.
 */
function tailLines(text, limit) {
  const lines = text.replace(/\s+$/, '').split('\n')
  return lines.slice(-limit).join('\n')
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
 * Build the error shown when the command printed no JSON object.
 * @param {string} stderr Command standard error.
 * @returns {string} Message with the standard error detail, when present.
 */
function nonJsonMessage(stderr) {
  const detail = typeof stderr === 'string' ? stderr.trim() : ''
  return `lipi вернул не JSON${detail === '' ? '' : ': ' + detail}`
}

/**
 * Build a successful command result.
 * @param {string} text Result text.
 * @returns {{kind: 'success', text: string}} A command result.
 */
function successResult(text) {
  return { kind: 'success', text }
}

/**
 * Build an error command result.
 * @param {string} text Error text.
 * @returns {{kind: 'error', text: string}} A command result.
 */
function errorResult(text) {
  return { kind: 'error', text }
}

/**
 * Render an unknown thrown value as text.
 * @param {unknown} error Thrown value.
 * @returns {string} Its message or string form.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
