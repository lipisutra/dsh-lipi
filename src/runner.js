/**
 * Build and run the installed `lipi` command as a child process; no Cordis
 * dependency. The project root is passed as the working directory, and the
 * bundle never points at a checker file inside the project.
 * @module @lipisutra/dsh-lipi/runner
 */
import { spawnSync } from 'node:child_process'

/** Prefix Windows uses for a WSL distribution filesystem. */
const WSL_UNC_PREFIX = '\\\\wsl.localhost\\'

/** Cooperative limit for one lipi run. */
const CHECK_TIMEOUT_MS = 60_000

/** Largest amount of lipi output kept in memory. */
const CHECK_MAX_BUFFER = 4 * 1024 * 1024

/** Default command name: the installed `lipi` found through PATH. */
const DEFAULT_LIPI_CMD = 'lipi'

/** Install hint shown when the command is missing. */
const INSTALL_HINT = 'pipx install git+https://github.com/lipisutra/lipi'

/**
 * Convert a Windows WSL path into the POSIX path the distribution sees.
 * @param {string} winPath Path such as `\\\\wsl.localhost\\Ubuntu\\home\\dev\\app`.
 * @param {string} distro WSL distribution name, for example `Ubuntu`.
 * @returns {string} `/home/dev/app`, or the input when it is not under that distribution.
 */
export function posixPath(winPath, distro) {
  const normalized = String(winPath).replaceAll('\\', '/')
  const prefix = `//wsl.localhost/${distro}`
  if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) return winPath
  const rest = normalized.slice(prefix.length)
  if (rest === '') return '/'
  return rest.startsWith('/') ? rest : `/${rest}`
}

/**
 * The command that starts lipi: the configured path, or `lipi` from PATH.
 * @param {{lipiPath?: string}} cfg Bundle configuration.
 * @returns {string} Executable name or path.
 */
export function lipiCommand(cfg) {
  return typeof cfg.lipiPath === 'string' && cfg.lipiPath !== '' ? cfg.lipiPath : DEFAULT_LIPI_CMD
}

/**
 * Build the argv that runs the installed lipi command.
 *
 * A normal project is started directly (`lipi check --format json …`) with
 * the project root as the working directory. A project opened through
 * `\\wsl.localhost\…` on Windows is started inside WSL: the project root is
 * translated to its Linux form and passed as `--cd`, so the command runs in
 * the same directory the distribution sees.
 * @param {{root: string}} project Resolved project.
 * @param {string[]} args Command arguments, starting with the subcommand (`check`, `new`, …).
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {string[]} argv for `child_process.spawnSync`.
 */
export function buildCommand(project, args, cfg) {
  const command = lipiCommand(cfg)
  if (process.platform === 'win32' && project.root.startsWith(WSL_UNC_PREFIX)) {
    return [
      'wsl.exe',
      '-d',
      cfg.wslDistro,
      '--cd',
      posixPath(project.root, cfg.wslDistro),
      '-e',
      command,
      ...args,
    ]
  }
  return [command, ...args]
}

/**
 * Build the error raised when the spawned executable does not exist.
 * @param {string} command Executable that could not be started.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {Error} Error with a friendly message and installation hint.
 */
function commandNotFoundError(command, cfg) {
  const lipiPath = typeof cfg.lipiPath === 'string' && cfg.lipiPath !== '' ? cfg.lipiPath : null
  const pathHint = lipiPath === null
    ? 'Если lipi установлен в нестандартное место, укажите путь к нему в настройке lipiPath.'
    : `Проверьте путь в настройке lipiPath: «${lipiPath}».`
  if (command === 'wsl.exe') {
    return new Error(`не найдена команда wsl.exe: WSL не установлен или недоступен. Установите lipi внутри WSL: ${INSTALL_HINT}. ${pathHint}`)
  }
  return new Error(`команда lipi не найдена: «${command}». Установите lipi: ${INSTALL_HINT}. ${pathHint}`)
}

/**
 * Start one executable synchronously and capture its output. A missing
 * executable (`ENOENT`) becomes the descriptive installation error; other spawn
 * failures are reported through `stderr` and a non-zero exit code.
 * @param {string} command Executable name or path.
 * @param {string[]} commandArgs Command arguments.
 * @param {string} cwd Working directory.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {{code: number, stdout: string, stderr: string}} Exit code and captured output.
 * @throws {Error} When the executable itself cannot be started (`ENOENT`).
 */
function spawnCommand(command, commandArgs, cwd, cfg) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    timeout: CHECK_TIMEOUT_MS,
    maxBuffer: CHECK_MAX_BUFFER,
    windowsHide: true,
  })
  if (result.error !== undefined && result.error.code === 'ENOENT') {
    throw commandNotFoundError(command, cfg)
  }
  const stderr = result.error === undefined
    ? (result.stderr ?? '')
    : (result.stderr || String(result.error.message))
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr }
}

/**
 * Run the installed lipi command synchronously in the project root.
 * @param {{root: string}} project Resolved project.
 * @param {string[]} args Command arguments, starting with the subcommand.
 * @param {{lipiPath: string, wslDistro: string}} cfg Bundle configuration.
 * @returns {{code: number, stdout: string, stderr: string}} Exit code and captured output.
 */
export function runCheck(project, args, cfg) {
  const [command, ...commandArgs] = buildCommand(project, args, cfg)
  return spawnCommand(command, commandArgs, project.root, cfg)
}

/**
 * Run the installed lipi command synchronously outside a project, in the
 * current directory. Used by `/lipi-lang`: the interface language is personal,
 * so the command needs no project.
 * @param {string[]} args Command arguments, starting with the subcommand.
 * @param {{lipiPath: string, wslDistro?: string}} cfg Bundle configuration.
 * @returns {{code: number, stdout: string, stderr: string}} Exit code and captured output.
 * @throws {Error} When the installed command is missing.
 */
export function runInstalled(args, cfg) {
  return spawnCommand(lipiCommand(cfg), args, process.cwd(), cfg)
}
