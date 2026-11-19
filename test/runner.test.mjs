import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { buildCommand, posixPath, runCheck } from '../src/runner.js'
import { canRunFakeLipi, createFakeLipi, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu' }

const WSL_PROJECT = { root: '\\\\wsl.localhost\\Ubuntu\\home\\dev\\app' }

const WINDOWS_PROJECT = { root: 'C:\\work\\app' }

const POSIX_PROJECT = { root: '/srv/app' }

/** @type {Record<string, string>} */
const STDOUT = {
  check: JSON.stringify({
    schema: 1,
    version: '1.0.1',
    errors: [],
    warnings: [],
    summary: { pages: 1, docs: 0, tags: 0, errors: 0, warnings: 0 },
  }),
}

/**
 * Run `body` with a temporary `process.platform` value.
 * @param {string} platform Simulated platform.
 * @param {() => unknown} body Work to run.
 * @returns {unknown} Whatever `body` returns.
 */
function withPlatform(platform, body) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  assert.ok(descriptor?.configurable, 'process.platform must be configurable for this test')
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform })
  try {
    return body()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

/**
 * Create a temporary directory that stands in for a project root.
 * @returns {string} Absolute directory.
 */
function temporaryProject() {
  return resolve(mkdtempSync(join(tmpdir(), 'lipi-runner-')))
}

test('posixPath переводит путь WSL в POSIX', () => {
  assert.equal(posixPath(WSL_PROJECT.root, 'Ubuntu'), '/home/dev/app')
  assert.equal(posixPath('\\\\wsl.localhost\\Ubuntu', 'Ubuntu'), '/')
  assert.equal(posixPath('C:\\work\\app', 'Ubuntu'), 'C:\\work\\app')
})

test('buildCommand запускает установленную команду lipi на POSIX', () => {
  const command = withPlatform('linux', () => buildCommand(POSIX_PROJECT, ['check', '--format', 'json', '--staged'], CFG))
  assert.deepEqual(command, ['lipi', 'check', '--format', 'json', '--staged'])
})

test('buildCommand берёт путь к lipi из lipiPath', () => {
  const cfg = { ...CFG, lipiPath: '/opt/lipi/bin/lipi' }
  const command = withPlatform('linux', () => buildCommand(POSIX_PROJECT, ['check', '--format', 'json'], cfg))
  assert.deepEqual(command, ['/opt/lipi/bin/lipi', 'check', '--format', 'json'])
})

test('buildCommand запускает lipi напрямую для обычного пути Windows', () => {
  const command = withPlatform('win32', () => buildCommand(WINDOWS_PROJECT, ['check', '--format', 'json'], CFG))
  assert.deepEqual(command, ['lipi', 'check', '--format', 'json'])
})

test('buildCommand запускает lipi через WSL для проекта в WSL', () => {
  const command = withPlatform('win32', () => buildCommand(WSL_PROJECT, ['check', '--format', 'json', '--audit'], CFG))
  assert.deepEqual(command, [
    'wsl.exe',
    '-d',
    'Ubuntu',
    '--cd',
    '/home/dev/app',
    '-e',
    'lipi',
    'check',
    '--format',
    'json',
    '--audit',
  ])
})

test('buildCommand переводит в Linux-вид и путь к lipiPath в WSL', () => {
  const cfg = { ...CFG, lipiPath: '/usr/local/bin/lipi' }
  const command = withPlatform('win32', () => buildCommand(WSL_PROJECT, ['check', '--format', 'json'], cfg))
  assert.deepEqual(command, [
    'wsl.exe',
    '-d',
    'Ubuntu',
    '--cd',
    '/home/dev/app',
    '-e',
    '/usr/local/bin/lipi',
    'check',
    '--format',
    'json',
  ])
})

test('runCheck запускает lipi из PATH в корне проекта', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: STDOUT.check })
  const root = temporaryProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const result = await withFakePath(fake.dir, () => runCheck({ root }, ['check', '--format', 'json'], CFG))
  assert.equal(result.code, 0)
  assert.equal(result.stdout, STDOUT.check)
  assert.equal(result.stderr, '')
  assert.deepEqual(fake.arguments(), ['check', '--format', 'json'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runCheck сохраняет код возврата и stderr команды', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: 'не json', stderr: 'ошибка lipi', exitCode: 2 })
  const root = temporaryProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const result = await withFakePath(fake.dir, () => runCheck({ root }, ['check', '--format', 'json'], CFG))
  assert.equal(result.code, 2)
  assert.equal(result.stdout, 'не json')
  assert.equal(result.stderr, 'ошибка lipi')
})

test('runCheck объясняет, что команда lipi не найдена', async (t) => {
  const root = temporaryProject()
  const missing = join(root, 'no-such-lipi')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: missing }
  await assert.rejects(
    withFakePath(root, () => runCheck({ root }, ['check', '--format', 'json'], cfg)),
    (error) => {
      assert.match(error.message, /команда lipi не найдена/)
      assert.match(error.message, /pipx install git\+https:\/\/github\.com\/lipisutra\/lipi/)
      assert.match(error.message, /lipiPath/)
      assert.ok(error.message.includes(missing))
      return true
    },
  )
})
