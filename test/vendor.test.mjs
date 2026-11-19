import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { parseSemver } from '../src/semver.js'
import { findLipi, findPython, listEditions, queryDataDir } from '../scripts/vendor.mjs'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const referencesDir = join(packageRoot, 'skills', 'lipi', 'references')

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

test('version.json — снимок установленного lipi с семвером', async () => {
  const text = await readFile(join(referencesDir, 'version.json'), 'utf8')
  let snapshot
  try {
    snapshot = JSON.parse(text)
  } catch (error) {
    assert.fail(`version.json не разбирается как JSON: ${error.message}`)
  }
  assert.equal(typeof snapshot.lipi, 'string', 'в version.json нет строки lipi')
  assert.notEqual(
    parseSemver(snapshot.lipi),
    null,
    `version.json: lipi «${snapshot.lipi}» — не семвер`,
  )
  assert.equal(typeof snapshot.min, 'string', 'в version.json нет строки min')
  assert.notEqual(parseSemver(snapshot.min), null, `version.json: min «${snapshot.min}» — не семвер`)
})

test('справочники разложены по языковым редакциям', async () => {
  const entries = await readdir(referencesDir, { withFileTypes: true })
  const topLevel = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  assert.deepEqual(
    topLevel,
    ['setup.md', 'version.json'],
    'в корне skills/lipi/references только setup.md и version.json — запустите node scripts/vendor.mjs',
  )
  const editions = entries.filter((entry) => entry.isDirectory())
  assert.notEqual(editions.length, 0, 'в skills/lipi/references нет ни одной языковой редакции')
  for (const edition of editions) {
    assert.match(edition.name, /^[A-Za-z][A-Za-z0-9_-]*$/, `каталог «${edition.name}» — не код языка`)
    const files = await readdir(join(referencesDir, edition.name))
    assert.notEqual(
      files.filter((file) => file.endsWith('.md')).length,
      0,
      `в редакции «${edition.name}» нет Markdown-страниц`,
    )
  }
})

test('копии справочников совпадают с установленным пакетом lipi', async (t) => {
  const bin = findLipi()
  if (bin === null) {
    t.skip('установленная команда lipi не найдена (PATH и LIPI_BIN) — сверка с пакетом пропущена')
    return
  }

  const pythonResult = findPython(bin)
  if (pythonResult.python === null) {
    t.skip(`не удалось определить Python по shebang «${bin}» (${pythonResult.detail}) — сверка с пакетом пропущена`)
    return
  }

  const dataResult = queryDataDir(pythonResult.python)
  if (dataResult.path === null) {
    t.skip(`не удалось получить data-каталог Python «${pythonResult.python}» (${dataResult.detail}) — сверка с пакетом пропущена`)
    return
  }

  const shareDir = join(dataResult.path, 'share', 'lipi')
  if (!(await isDirectory(shareDir))) {
    t.skip(`установленный lipi «${bin}» не поставляет share/lipi (${shareDir}) — сверять не с чем, проверка пропущена`)
    return
  }

  const editions = await listEditions(join(shareDir, 'docs'))
  assert.notEqual(
    editions.length,
    0,
    `установленный lipi «${bin}» не поставляет языковых редакций в ${join(shareDir, 'docs')}`,
  )
  for (const edition of editions) {
    for (const file of edition.files) {
      const installed = await readFile(join(shareDir, 'docs', edition.language, file))
      const copied = await readFile(join(referencesDir, edition.language, file))
      assert.equal(
        copied.equals(installed),
        true,
        `${join('skills', 'lipi', 'references', edition.language, file)} расходится с ` +
        `${join(shareDir, 'docs', edition.language, file)} — запустите node scripts/vendor.mjs`,
      )
    }
  }

  const setupInstalled = join(shareDir, 'SETUP.md')
  if (!(await isFile(setupInstalled))) {
    assert.fail(`установленный lipi «${bin}» не поставляет ${setupInstalled}`)
  }
  const copiedSetup = await readFile(join(referencesDir, 'setup.md'))
  assert.equal(
    copiedSetup.equals(await readFile(setupInstalled)),
    true,
    `${join('skills', 'lipi', 'references', 'setup.md')} расходится с ${setupInstalled} ` +
    '— запустите node scripts/vendor.mjs',
  )
})
