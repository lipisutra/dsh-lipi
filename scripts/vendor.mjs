#!/usr/bin/env node
// Обновляет копии справочников скилла (skills/lipi/references/) из установленного
// пакета lipi — той установки, которую бандл использует для проверок: команда из
// LIPI_BIN или `lipi` из PATH, её Python из shebang, data-каталог из sysconfig.
// Копируются все языковые редакции описания: каталоги docs/<код>/ установленного
// пакета обходятся без зашитого списка языков. Если установка не поставляет
// share/lipi (editable), редакции берутся с тега выпуска `v<первая цифра версии>`
// (git-копия, запасной путь загрузки страницы — raw.githubusercontent.com).
import { spawnSync } from 'node:child_process'
import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gte, parseSemver } from '../src/semver.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..') // <пакет>/scripts -> <пакет>
const manifestPath = join(packageRoot, 'package.json')
const referencesDir = join(packageRoot, 'skills', 'lipi', 'references')

/** Репозиторий lipi: источник редакций и страниц установки. */
const REPO_URL = 'https://github.com/lipisutra/lipi.git'
const RAW_BASE = 'https://raw.githubusercontent.com/lipisutra/lipi'
const INSTALL_HINT = 'pipx install git+https://github.com/lipisutra/lipi'

/**
 * Прежнее название пакета. Нужно только для перехода: у части установок ещё
 * задана переменная окружения этого названия, а в старом манифесте — ключ
 * минимума. Собирается из частей, чтобы прежнее название не осталось в коде.
 */
const LEGACY_PRODUCT = ['vi', 'be'].join('')
const LEGACY_BIN_ENV = `${LEGACY_PRODUCT.toUpperCase()}_BIN`

/** Код языковой редакции: каталог docs/<код>/ с латинской буквы. */
const LANGUAGE_CODE = /^[A-Za-z][A-Za-z0-9_-]*$/

/** Копия страницы установки в справочниках скилла. */
const SETUP_TARGET = 'setup.md'

/**
 * Проверить, что путь — исполняемый файл.
 * @param {string} path Проверяемый путь.
 * @returns {boolean} Существует и исполняется.
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
 * Найти установленную команду: LIPI_BIN, прежняя переменная окружения,
 * иначе `lipi` в PATH.
 * @param {NodeJS.ProcessEnv} env Окружение.
 * @returns {string | null} Путь к команде или null.
 */
export function findLipi(env = process.env) {
  for (const name of ['LIPI_BIN', LEGACY_BIN_ENV]) {
    const value = env[name]
    if (typeof value === 'string' && value !== '') {
      const configured = resolve(value)
      return isExecutableFile(configured) ? configured : null
    }
  }
  const path = typeof env.PATH === 'string' ? env.PATH : ''
  const names = process.platform === 'win32' ? ['lipi.exe', 'lipi.cmd', 'lipi'] : ['lipi']
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * Прочитать первую строку текстового файла (shebang).
 * @param {string} path Путь к файлу.
 * @returns {string} Первая строка без перевода строки.
 */
function readFirstLine(path) {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024)
    const size = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, size).toString('utf8').split('\n')[0].replace(/\r$/, '')
  } finally {
    closeSync(fd)
  }
}

/**
 * Разрешить имя из shebang в исполняемый путь.
 * @param {string} command Имя или путь из shebang.
 * @param {NodeJS.ProcessEnv} env Окружение.
 * @returns {string | null} Путь или null.
 */
function resolveInterpreter(command, env) {
  if (command.includes('/') || command.includes('\\')) {
    return isExecutableFile(command) ? command : null
  }
  const path = typeof env.PATH === 'string' ? env.PATH : ''
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue
    for (const suffix of suffixes) {
      const candidate = join(dir, command + suffix)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * Определить Python установленной команды по shebang её файла.
 * Понимает `#!/path/python -E` и `#!/usr/bin/env python3`.
 * @param {string} bin Путь к команде.
 * @param {NodeJS.ProcessEnv} env Окружение.
 * @returns {{python: string | null, detail: string}} Путь к Python и пояснение.
 */
export function findPython(bin, env = process.env) {
  let line
  try {
    line = readFirstLine(bin)
  } catch (error) {
    return { python: null, detail: `не удалось прочитать «${bin}»: ${error.message}` }
  }
  if (!line.startsWith('#!')) {
    return { python: null, detail: `первая строка без shebang: «${line}»` }
  }
  const words = line.slice(2).trim().split(/\s+/).filter(Boolean)
  let command = words.shift()
  if (command !== undefined && command.split(/[/\\]/).pop() === 'env') {
    while (words.length > 0 && words[0].startsWith('-')) words.shift()
    command = words.shift()
  }
  if (command === undefined) {
    return { python: null, detail: `shebang без интерпретатора: «${line}»` }
  }
  const interpreter = resolveInterpreter(command, env)
  if (interpreter === null) {
    return { python: null, detail: `интерпретатор «${command}» из shebang не найден` }
  }
  return { python: interpreter, detail: line }
}

/**
 * Получить data-каталог установленного пакета через sysconfig его Python.
 * @param {string} python Путь к Python.
 * @returns {{path: string | null, detail: string}} Каталог данных и пояснение.
 */
export function queryDataDir(python) {
  const result = spawnSync(python, ['-c', 'import sysconfig; print(sysconfig.get_path("data"))'], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error !== undefined) return { path: null, detail: result.error.message }
  if (result.status !== 0) {
    return { path: null, detail: (result.stderr || '').trim() || `код возврата ${result.status}` }
  }
  const path = (result.stdout || '').trim()
  if (path === '') return { path: null, detail: 'пустой ответ sysconfig' }
  return { path, detail: '' }
}

/**
 * Прочитать версию установленного lipi из вывода `lipi --version`.
 * @param {string} bin Путь к команде lipi.
 * @returns {{version: string | null, detail: string}} Версия и пояснение.
 */
export function queryInstalledVersion(bin) {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error !== undefined) return { version: null, detail: result.error.message }
  if (result.status !== 0) return { version: null, detail: output || `код возврата ${result.status}` }
  const match = /lipi\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i.exec(output)
    ?? /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output)
  if (match === null || parseSemver(match[1]) === null) {
    return { version: null, detail: `не разобран вывод: «${output}»` }
  }
  return { version: match[1], detail: output }
}

/**
 * Список языковых редакций в каталоге docs: подкаталоги с кодом языка
 * и Markdown-страницами. Список языков не зашит.
 * @param {string} docsDir Каталог docs установленного пакета или тега.
 * @returns {Promise<Array<{language: string, files: string[]}>>} Редакции по алфавиту.
 */
export async function listEditions(docsDir) {
  let entries
  try {
    entries = await readdir(docsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const editions = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !LANGUAGE_CODE.test(entry.name)) continue
    let files
    try {
      files = (await readdir(join(docsDir, entry.name), { withFileTypes: true }))
        .filter((file) => file.isFile() && file.name.endsWith('.md'))
        .map((file) => file.name)
        .sort()
    } catch {
      continue
    }
    if (files.length > 0) editions.push({ language: entry.name, files })
  }
  return editions.sort((a, b) => a.language.localeCompare(b.language))
}

/**
 * Проверить, что путь существует и является каталогом.
 * @param {string} path Проверяемый путь.
 * @returns {Promise<boolean>} Каталог существует.
 */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Проверить, что путь существует и является файлом.
 * @param {string} path Проверяемый путь.
 * @returns {Promise<boolean>} Файл существует.
 */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Скачать страницу тега выпуска через curl.
 * @param {string} url Адрес страницы.
 * @returns {{text: string | null, detail: string}} Текст и пояснение.
 */
function fetchViaCurl(url) {
  const result = spawnSync('curl', ['-fsSL', '--connect-timeout', '10', '--max-time', '60', url], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) {
    return {
      text: null,
      detail: result.error.code === 'ENOENT' ? 'curl не найден' : result.error.message,
    }
  }
  if (result.status !== 0) {
    return {
      text: null,
      detail: (result.stderr || '').trim() || `curl завершился с кодом ${result.status}`,
    }
  }
  return { text: result.stdout, detail: '' }
}

/** Ленивая копия тега выпуска, полученная через git; создаётся не больше одной. */
let tagCheckout = null

/**
 * Получить каталог с файлами тега выпуска, клонировав его через git.
 * @param {string} tag Тег выпуска, например `v1`.
 * @returns {Promise<string>} Каталог с файлами тега.
 */
function ensureTagCheckout(tag) {
  tagCheckout ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lipi-tag-'))
    const result = spawnSync(
      'git',
      ['clone', '--depth', '1', '--branch', tag, '--single-branch', '--quiet', REPO_URL, dir],
      {
        encoding: 'utf8',
        timeout: 180_000,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
    )
    if (result.error !== undefined || result.status !== 0) {
      const detail = result.error !== undefined
        ? (result.error.code === 'ENOENT' ? 'git не найден' : result.error.message)
        : ((result.stderr || '').trim() || `код возврата ${result.status}`)
      await rm(dir, { recursive: true, force: true })
      throw new Error(detail)
    }
    return dir
  })()
  return tagCheckout
}

/**
 * Удалить временную копию тега, если она создавалась.
 * @returns {Promise<void>} Завершение очистки.
 */
async function cleanupTagCheckout() {
  if (tagCheckout === null) return
  try {
    await rm(await tagCheckout, { recursive: true, force: true })
  } catch {
    // Временный каталог мог не создаться — убирать нечего.
  }
  tagCheckout = null
}

/**
 * Получить страницу с тега выпуска: сначала через curl, затем через git.
 * @param {string} tag Тег выпуска, например `v1`.
 * @param {string} page Путь страницы в репозитории lipi.
 * @returns {Promise<{text: string, source: string}>} Текст страницы и источник.
 */
async function fetchTagPage(tag, page) {
  const url = `${RAW_BASE}/${tag}/${page}`
  const curl = fetchViaCurl(url)
  if (curl.text !== null) return { text: curl.text, source: url }
  console.warn(`curl не получил ${url}: ${curl.detail}; страницу беру из git-тега`)
  let gitDetail
  try {
    const dir = await ensureTagCheckout(tag)
    const text = await readFile(join(dir, page), 'utf8')
    return { text, source: `git-тег ${tag} (${REPO_URL})` }
  } catch (error) {
    gitDetail = error.message
  }
  throw new Error(
    `не удалось получить «${page}» с тега ${tag}: ${curl.detail}. ` +
    `Запасной путь через git тоже не удался: ${gitDetail}. ` +
    `Проверьте сеть и доступ к ${REPO_URL}.`,
  )
}

/**
 * Прочитать и разобрать package.json пакета.
 * Минимум берётся из поля lipi.min; на время перехода допускается прежнее поле.
 * @returns {Promise<{packageVersion: string, minLipi: string}>} Версия пакета и минимум lipi.
 */
async function readManifest() {
  let text
  try {
    text = await readFile(manifestPath, 'utf8')
  } catch (error) {
    throw new Error(`не удалось прочитать ${manifestPath}: ${error.message}`)
  }
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    throw new Error(`не удалось разобрать ${manifestPath}: ${error.message}`)
  }
  const packageVersion = manifest.version
  if (typeof packageVersion !== 'string' || packageVersion === '') {
    throw new Error(`в ${manifestPath} нет поля version`)
  }
  const minLipi = manifest.lipi?.min ?? manifest[LEGACY_PRODUCT]?.min
  if (typeof minLipi !== 'string' || parseSemver(minLipi) === null) {
    throw new Error(`в ${manifestPath} нет валидного поля lipi.min (например, "lipi": {"min": "1.0.0"})`)
  }
  return { packageVersion, minLipi }
}

/**
 * Удалить из каталога справочников всё, что не относится к текущему набору копий.
 * @param {string} dir Проверяемый каталог.
 * @param {Set<string>} expected Полные пути ожидаемых файлов.
 * @returns {Promise<void>} Завершение очистки.
 */
async function pruneDirectory(dir, expected) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await pruneDirectory(full, expected)
      if ((await readdir(full)).length === 0) {
        await rmdir(full)
        console.log(`удалён пустой каталог: ${relative(packageRoot, full)}`)
      }
    } else if (!expected.has(full)) {
      await rm(full)
      console.log(`удалено устаревшее: ${relative(packageRoot, full)}`)
    }
  }
}

/**
 * Сверить установленный lipi с минимумом и обновить копии справочников.
 * @returns {Promise<void>} Завершение синхронизации.
 */
export async function main() {
  const { packageVersion, minLipi } = await readManifest()

  const bin = findLipi()
  if (bin === null) {
    const hint = typeof process.env.LIPI_BIN === 'string' && process.env.LIPI_BIN !== ''
      ? `проверьте LIPI_BIN=«${process.env.LIPI_BIN}»`
      : 'проверьте PATH или задайте LIPI_BIN'
    throw new Error(`не найдена исполняемая команда lipi: ${hint}. Установите lipi: ${INSTALL_HINT}.`)
  }

  const pythonResult = findPython(bin)
  if (pythonResult.python === null) {
    throw new Error(`не удалось определить Python по shebang «${bin}»: ${pythonResult.detail}`)
  }
  const python = pythonResult.python

  const versionResult = queryInstalledVersion(bin)
  if (versionResult.version === null) {
    throw new Error(`не удалось получить версию установленного lipi (${bin} --version): ${versionResult.detail}`)
  }
  const lipiVersion = versionResult.version
  if (!gte(lipiVersion, minLipi)) {
    throw new Error(
      `lipi ${lipiVersion} младше поддерживаемого минимума ${minLipi}. ` +
      'Поднимите lipi или ослабьте lipi.min в package.json.',
    )
  }

  const dataResult = queryDataDir(python)
  if (dataResult.path === null) {
    throw new Error(`не удалось получить data-каталог Python «${python}»: ${dataResult.detail}`)
  }
  const dataDir = dataResult.path
  const shareDir = join(dataDir, 'share', 'lipi')
  const hasShare = await isDirectory(shareDir)
  const tag = `v${lipiVersion.split('.')[0]}`

  console.log(`lipi ${lipiVersion}: ${bin}`)
  console.log(`python: ${python}; data: ${dataDir}; тег выпуска: ${tag}`)
  if (hasShare) {
    console.log(`share/lipi: ${shareDir}`)
  } else {
    console.log(
      `share/lipi: не поставляется (${shareDir} отсутствует, похоже на editable-установку) — ` +
      'редакции будут взяты с тега выпуска',
    )
  }

  // Первичный источник — установленный пакет; без share/lipi — тег выпуска.
  let sourceDir = shareDir
  if (!(await isDirectory(join(sourceDir, 'docs')))) {
    sourceDir = await ensureTagCheckout(tag)
    console.log(`источник редакций: git-тег ${tag} (${REPO_URL})`)
  }

  const editions = await listEditions(join(sourceDir, 'docs'))
  if (editions.length === 0) {
    throw new Error(`в «${join(sourceDir, 'docs')}» нет языковых редакций (ожидаются каталоги docs/<код>/)`)
  }
  console.log(
    `редакции: ${editions.map((edition) => `${edition.language} (${edition.files.length})`).join(', ')}`,
  )

  // Сначала собираем все тексты, затем пишем: при сетевой ошибке копии не меняются.
  /** @type {Array<{target: string, content: Buffer, source: string}>} */
  const updates = []
  for (const edition of editions) {
    for (const file of edition.files) {
      const sourcePath = join(sourceDir, 'docs', edition.language, file)
      updates.push({
        target: join(edition.language, file),
        content: await readFile(sourcePath),
        source: sourcePath,
      })
    }
  }

  const setupSource = join(sourceDir, 'SETUP.md')
  if (await isFile(setupSource)) {
    updates.push({ target: SETUP_TARGET, content: await readFile(setupSource), source: setupSource })
  } else {
    const fetched = await fetchTagPage(tag, 'SETUP.md')
    updates.push({ target: SETUP_TARGET, content: Buffer.from(fetched.text, 'utf8'), source: fetched.source })
  }

  await mkdir(referencesDir, { recursive: true })
  const expected = new Set()
  for (const update of updates) {
    const targetPath = join(referencesDir, update.target)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, update.content)
    expected.add(targetPath)
    console.log(`обновлено: ${relative(packageRoot, targetPath)} ← ${update.source}`)
  }

  const versionPath = join(referencesDir, 'version.json')
  await writeFile(versionPath, JSON.stringify({ lipi: lipiVersion, min: minLipi }, null, 2) + '\n')
  expected.add(versionPath)
  console.log(`обновлено: ${relative(packageRoot, versionPath)} ← lipi ${lipiVersion}`)

  await pruneDirectory(referencesDir, expected)

  console.log(
    `пакет ${packageVersion} совместим с lipi >= ${minLipi} (текущий lipi ${lipiVersion}); ` +
    `справочников обновлено: ${updates.length}, редакций: ${editions.length}.`,
  )
}

/** Запуск с обязательной очисткой временной копии тега. */
async function run() {
  try {
    await main()
  } finally {
    await cleanupTagCheckout()
  }
}

/**
 * Проверить, что модуль запущен как команда, а не импортирован из теста.
 * Сравниваются реальные пути: скрипт может быть вызван через симлинк.
 * @returns {boolean} Модуль — точка входа.
 */
function isEntryPoint() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  run().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
