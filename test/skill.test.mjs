import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { loadSkill } from '../src/skill.js'

/**
 * Create a temporary package directory containing one SKILL.md.
 * @param {string} markdown File contents.
 * @returns {string} Absolute package root.
 */
function packageWithSkill(markdown) {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-skill-')))
  mkdirSync(join(root, 'skills', 'lipi'), { recursive: true })
  writeFileSync(join(root, 'skills', 'lipi', 'SKILL.md'), markdown)
  return root
}

test('loadSkill разбирает фронтматтер и оставляет тело', (t) => {
  const root = packageWithSkill([
    '---',
    'name: lipi',
    'description: Правила проекта lipi',
    'whenToUse: когда проект развёрнут по lipi',
    '---',
    '',
    '# lipi',
    '',
    'Текст.',
  ].join('\n') + '\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const skill = loadSkill(root)
  assert.equal(skill.name, 'lipi')
  assert.equal(skill.description, 'Правила проекта lipi')
  assert.equal(skill.whenToUse, 'когда проект развёрнут по lipi')
  assert.equal(skill.body, '# lipi\n\nТекст.\n')
})

test('loadSkill снимает кавычки и подставляет имя по умолчанию', (t) => {
  const root = packageWithSkill(['---', 'description: "Краткое описание"', '---', 'Тело'].join('\n'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const skill = loadSkill(root)
  assert.equal(skill.name, 'lipi')
  assert.equal(skill.description, 'Краткое описание')
  assert.equal(skill.whenToUse, undefined)
  assert.equal(skill.body, 'Тело')
})

test('loadSkill сообщает об отсутствии SKILL.md', (t) => {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-skill-missing-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.throws(() => loadSkill(root), /SKILL\.md/)
})
