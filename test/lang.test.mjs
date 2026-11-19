import assert from 'node:assert/strict'
import test from 'node:test'

import { parseLangLine, runLangCommand } from '../src/check-runner.js'
import { canRunFakeLipi, createFakeLipiForLang, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu' }

/** Skip marker for tests that must start the fake interpreter. */
const EXECUTION_SKIP = !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell'

test('parseLangLine разбирает необязательный код языка', () => {
  assert.deepEqual(parseLangLine(''), { lang: '' })
  assert.deepEqual(parseLangLine('  '), { lang: '' })
  assert.deepEqual(parseLangLine(' ru '), { lang: 'ru' })
  assert.deepEqual(parseLangLine('en'), { lang: 'en' })
  assert.deepEqual(parseLangLine('"ru"'), { lang: 'ru' })
})

test('parseLangLine отвергает лишние аргументы', () => {
  assert.throws(() => parseLangLine('ru en'), /не больше одного кода языка/)
})

test('runLangCommand без аргумента читает current и available', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipiForLang({ current: 'en', available: ['en', 'ru'] })
  t.after(() => fake.remove())
  const out = await withFakePath(fake.dir, () => runLangCommand('', CFG))
  assert.equal(out.kind, 'success')
  assert.deepEqual(JSON.parse(out.text), { current: 'en', available: ['en', 'ru'] })
  assert.deepEqual(fake.arguments(), [], 'чистое чтение не вызывает lipi lang')
})

test('runLangCommand с кодом переключает язык и перечитывает настройки', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipiForLang({ current: 'en', available: ['en', 'ru'] })
  t.after(() => fake.remove())
  const out = await withFakePath(fake.dir, () => runLangCommand(' ru ', CFG))
  assert.equal(out.kind, 'success')
  assert.deepEqual(JSON.parse(out.text), { current: 'ru', available: ['en', 'ru'] })
  assert.deepEqual(fake.arguments(), ['lang', 'ru'])
  assert.equal(fake.language(), 'ru')
})

test('runLangCommand сообщает об ошибке неизвестного языка', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipiForLang({ current: 'en', available: ['en', 'ru'] })
  t.after(() => fake.remove())
  const out = await withFakePath(fake.dir, () => runLangCommand('fr', CFG))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /lipi lang fr завершился с кодом 2/)
  assert.match(out.text, /unknown language: fr/)
  assert.equal(fake.language(), 'en', 'язык не изменился')
})

test('runLangCommand откатывается на en, когда Python у lipi недоступен', async (t) => {
  const fake = createFakeLipiForLang({ missingPython: true })
  t.after(() => fake.remove())
  const out = await withFakePath(fake.dir, () => runLangCommand('', CFG))
  assert.equal(out.kind, 'success')
  const parsed = JSON.parse(out.text)
  assert.equal(parsed.current, 'en')
  assert.deepEqual(parsed.available, ['en'])
  assert.match(parsed.note, /Python/)
})

test('runLangCommand без аргумента при недоступной команде даёт fallback с пометкой', () => {
  const out = runLangCommand('', { ...CFG, lipiPath: '/no/such/lipi' })
  assert.equal(out.kind, 'success')
  const parsed = JSON.parse(out.text)
  assert.equal(parsed.current, 'en')
  assert.deepEqual(parsed.available, ['en'])
  assert.match(parsed.note, /команда lipi не найдена/)
})

test('runLangCommand с кодом сообщает, что команда lipi не найдена', () => {
  const out = runLangCommand('ru', { ...CFG, lipiPath: '/no/such/lipi' })
  assert.equal(out.kind, 'error')
  assert.match(out.text, /команда lipi не найдена/)
  assert.match(out.text, /pipx install git\+https:\/\/github\.com\/lipisutra\/lipi/)
})
