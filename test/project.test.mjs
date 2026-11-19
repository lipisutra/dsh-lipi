import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { ProjectNotDeployedError, resolveProject } from '../src/project.js'

/**
 * Create a temporary directory; the caller owns its removal.
 * @param {string} prefix Directory name prefix.
 * @returns {string} Absolute temporary directory.
 */
function temporaryDirectory(prefix) {
  return resolve(mkdtempSync(join(tmpdir(), prefix)))
}

/**
 * Create a temporary project with `lipi.json` and no checker file.
 * @param {Record<string, unknown> | undefined} settings Settings to write; undefined leaves the config out.
 * @returns {string} Absolute project root.
 */
function deployProject(settings) {
  const root = temporaryDirectory('lipi-project-')
  if (settings !== undefined) writeFileSync(join(root, 'lipi.json'), JSON.stringify(settings))
  return root
}

/**
 * Create a temporary project marked only by the deployment lock.
 * @returns {string} Absolute project root.
 */
function deployLockedProject() {
  const root = temporaryDirectory('lipi-locked-')
  mkdirSync(join(root, '.agents', 'lipi'), { recursive: true })
  writeFileSync(join(root, '.agents', 'lipi', 'lipi.lock'), '{"lipi": "1.0.1", "files": {}}')
  return root
}

test('resolveProject находит корень по lipi.json из вложенного каталога', (t) => {
  const root = deployProject({ docs: 'docs', workflow: 'workflow' })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nested = join(root, 'workflow', 'plan', 'current')
  mkdirSync(nested, { recursive: true })
  const project = resolveProject(nested)
  assert.equal(project.root, root)
  assert.deepEqual(project.config, { docs: 'docs', workflow: 'workflow' })
})

test('resolveProject находит корень по lipi.lock, даже без lipi.json', (t) => {
  const root = deployLockedProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = resolveProject(root)
  assert.equal(project.root, root)
  assert.equal(project.config, null)
})

test('resolveProject берёт ближайший развёрнутый каталог', (t) => {
  const outer = deployProject({ docs: 'docs' })
  const inner = join(outer, 'nested', 'project')
  mkdirSync(inner, { recursive: true })
  writeFileSync(join(inner, 'lipi.json'), '{"docs": "inner"}')
  t.after(() => rmSync(outer, { recursive: true, force: true }))
  assert.equal(resolveProject(inner).root, inner)
  assert.equal(resolveProject(join(inner, 'docs')).root, inner)
})

test('resolveProject читает lipi.json и возвращает null без файла', (t) => {
  const withConfig = deployProject({ docs: 'docs', workflow: 'workflow' })
  const withLock = deployLockedProject()
  t.after(() => {
    rmSync(withConfig, { recursive: true, force: true })
    rmSync(withLock, { recursive: true, force: true })
  })
  assert.deepEqual(resolveProject(withConfig).config, { docs: 'docs', workflow: 'workflow' })
  assert.equal(resolveProject(withLock).config, null)
})

test('resolveProject не падает на нечитаемом lipi.json', (t) => {
  const root = temporaryDirectory('lipi-broken-config-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'lipi.json'), '{ это не JSON')
  const project = resolveProject(root)
  assert.equal(project.root, root)
  assert.equal(project.config, null)
})

test('resolveProject сообщает, что проект не развёрнут', (t) => {
  const root = temporaryDirectory('lipi-bare-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.throws(() => resolveProject(root), (error) => {
    assert.ok(error instanceof ProjectNotDeployedError)
    assert.match(error.message, /проект не развёрнут по lipi/)
    assert.match(error.message, /нет lipi\.json/)
    assert.match(error.message, /запустите lipi init/)
    assert.equal(error.code, 'PROJECT_NOT_DEPLOYED')
    assert.equal(error.startDir, root)
    return true
  })
})

test('resolveProject не считает развёрнутым каталог только с check.py', (t) => {
  // Бандл больше не ищет чекер в проекте: файл без lipi.json и lock не признак проекта.
  const root = temporaryDirectory('lipi-stray-checker-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.agents', 'lipi'), { recursive: true })
  writeFileSync(join(root, '.agents', 'lipi', 'check.py'), '')
  assert.throws(() => resolveProject(root), ProjectNotDeployedError)
})
