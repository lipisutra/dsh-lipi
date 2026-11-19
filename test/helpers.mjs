/**
 * Test fixtures: a fake `lipi` executable placed on PATH, and a fake `lipi`
 * whose shebang points at a fake Python that serves the `/lipi-lang` settings
 * probe. The plain fixture records its arguments and working directory, then
 * prints the configured stdout/stderr and exits with the configured code. No
 * checker file is created in the project — the deployed project only carries
 * `lipi.json` or the lock file.
 * @module @lipisutra/dsh-lipi/test/helpers
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

/**
 * Whether the fake command can actually be spawned here. On Windows a `.cmd`
 * shim cannot be started by `spawnSync` without a shell, so execution tests are
 * skipped there; command-building tests still run everywhere.
 * @type {boolean}
 */
export const canRunFakeLipi = process.platform !== 'win32'

/**
 * Create a temporary directory with a fake `lipi` command.
 * @param {{stdout?: string, stderr?: string, exitCode?: number}} [options] What the command prints and returns.
 * @returns {{dir: string, arguments: () => string[], workingDirectory: () => string, setStdout: (text: string) => void, remove: () => void}} Fixture handle.
 */
export function createFakeLipi(options = {}) {
  const { stdout = '{}', stderr = '', exitCode = 0 } = options
  const dir = resolve(mkdtempSync(join(tmpdir(), 'lipi-fake-')))
  writeFileSync(join(dir, 'stdout.txt'), stdout)
  writeFileSync(join(dir, 'stderr.txt'), stderr)
  writeFileSync(join(dir, 'exit.txt'), String(exitCode))
  if (process.platform === 'win32') writeCommandScript(dir)
  else writeShellScript(dir)
  return {
    dir,
    /** @returns {string[]} Arguments the fake command received. */
    arguments() {
      return readLines(join(dir, 'argv.txt'))
    },
    /** @returns {string} Working directory the fake command ran in. */
    workingDirectory() {
      return readFileSync(join(dir, 'cwd.txt'), 'utf8').trim()
    },
    /** @param {string} text New stdout the fake command prints. */
    setStdout(text) {
      writeFileSync(join(dir, 'stdout.txt'), text)
    },
    remove() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Put `dir` first on PATH for the duration of `body`.
 * @template T
 * @param {string} dir Directory with the fake command.
 * @param {() => T | Promise<T>} body Work that spawns the command.
 * @returns {Promise<T>} Whatever `body` returns.
 */
export async function withFakePath(dir, body) {
  const previous = process.env.PATH
  process.env.PATH = previous === undefined ? dir : `${dir}${delimiter}${previous}`
  try {
    return await body()
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
}

/**
 * Create a temporary `lipi` command for language tests. Its shebang asks the
 * fake `python` on PATH for the settings (`python -c …`) and for the CLI, so
 * the probe prints the current language and the available list as JSON, while a
 * direct invocation acts as the lipi CLI and implements `lipi lang <код>` by
 * rewriting the state file. The fake interpreter is a plain `#!/bin/sh` script,
 * so no nested shebang is needed.
 * @param {{current?: string, available?: string[], missingPython?: boolean}} [options] Initial language state and shebang mode.
 * @returns {{dir: string, binPath: string, pythonPath: string, arguments: () => string[], language: () => string, remove: () => void}} Fixture handle.
 */
export function createFakeLipiForLang(options = {}) {
  const { current = 'en', available = ['en', 'ru'], missingPython = false } = options
  const dir = resolve(mkdtempSync(join(tmpdir(), 'lipi-lang-')))
  const pythonName = missingPython ? 'no-such-python' : 'python'
  const pythonPath = join(dir, pythonName)
  writeFileSync(join(dir, 'language.txt'), current)
  writeFileSync(join(dir, 'available.txt'), available.join(' '))
  writeFileSync(join(dir, 'available.json'), JSON.stringify(available))
  if (!missingPython) {
    writeFileSync(pythonPath, PYTHON_SCRIPT)
    chmodSync(pythonPath, 0o755)
  }
  writeFileSync(join(dir, 'lipi'), `#!/usr/bin/env ${pythonName}\n# фейковая команда lipi для /lipi-lang\n`)
  chmodSync(join(dir, 'lipi'), 0o755)
  return {
    dir,
    binPath: join(dir, 'lipi'),
    pythonPath,
    /** @returns {string[]} Arguments the fake CLI received. */
    arguments() {
      return readLines(join(dir, 'argv.txt'))
    },
    /** @returns {string} Current language stored by the fake. */
    language() {
      return readFileSync(join(dir, 'language.txt'), 'utf8').trim()
    },
    remove() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Read a newline-separated file; a missing file means no arguments.
 * @param {string} path File path.
 * @returns {string[]} Non-empty lines.
 */
function readLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter((line) => line !== '')
  } catch {
    return []
  }
}

/**
 * POSIX shell shim for the fake command.
 * @param {string} dir Fixture directory.
 */
function writeShellScript(dir) {
  const script = join(dir, 'lipi')
  writeFileSync(script, [
    '#!/bin/sh',
    'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'printf "%s\\n" "$@" > "$DIR/argv.txt"',
    'pwd -P > "$DIR/cwd.txt"',
    'cat "$DIR/stdout.txt"',
    'cat "$DIR/stderr.txt" >&2',
    'exit "$(cat "$DIR/exit.txt")"',
  ].join('\n'))
  chmodSync(script, 0o755)
}

/**
 * Windows batch shim for the fake command.
 * @param {string} dir Fixture directory.
 */
function writeCommandScript(dir) {
  writeFileSync(join(dir, 'lipi.cmd'), [
    '@echo off',
    'setlocal',
    'set "DIR=%~dp0"',
    'break>"%DIR%argv.txt"',
    ':args',
    'if "%~1"=="" goto done',
    '>>"%DIR%argv.txt" echo %~1',
    'shift',
    'goto args',
    ':done',
    'cd > "%DIR%cwd.txt"',
    'type "%DIR%stdout.txt"',
    'type "%DIR%stderr.txt" 1>&2',
    'set /p CODE=<"%DIR%exit.txt"',
    'exit /b %CODE%',
  ].join('\r\n'))
}

/**
 * Fake Python for the language fixture: serves the i18n probe and doubles as
 * the lipi CLI behind the fixture's shebang.
 */
const PYTHON_SCRIPT = [
  '#!/bin/sh',
  'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
  'if [ "$1" = "-c" ]; then',
  '  printf \'{"available": %s, "current": "%s"}\\n\' "$(cat "$DIR/available.json")" "$(cat "$DIR/language.txt")"',
  '  exit 0',
  'fi',
  'shift',
  'printf "%s\\n" "$@" > "$DIR/argv.txt"',
  'if [ "$1" = "lang" ] && [ -n "$2" ]; then',
  '  case " $(cat "$DIR/available.txt") " in',
  '    *" $2 "*) printf "%s\\n" "$2" > "$DIR/language.txt"; printf "%s\\n" "$2"; exit 0 ;;',
  '    *) printf "lipi: unknown language: %s\\n" "$2" >&2; exit 2 ;;',
  '  esac',
  'fi',
  'printf "lipi: unexpected command\\n" >&2',
  'exit 2',
].join('\n')
