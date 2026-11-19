import assert from 'node:assert/strict'
import test from 'node:test'

import { compareSemver, gte, isOlder, parseSemver } from '../src/semver.js'

test('parseSemver разбирает X.Y.Z и отбрасывает prerelease', () => {
  assert.deepEqual(parseSemver('0.6.0'), [0, 6, 0])
  assert.deepEqual(parseSemver(' 1.2.3 '), [1, 2, 3])
  assert.deepEqual(parseSemver('0.6.0-rc.1'), [0, 6, 0])
  assert.deepEqual(parseSemver('0.6.0+build.5'), [0, 6, 0])
  assert.equal(parseSemver('0.6'), null)
  assert.equal(parseSemver('0.6.0.1'), null)
  assert.equal(parseSemver('abc'), null)
  assert.equal(parseSemver(undefined), null)
})

test('compareSemver сравнивает числовые сегменты', () => {
  assert.equal(compareSemver('0.6.0', '0.6.0'), 0)
  assert.equal(compareSemver('0.7.0', '0.6.0'), 1)
  assert.equal(compareSemver('0.5.0', '0.6.0'), -1)
  assert.equal(compareSemver('0.6.1', '0.6.0'), 1)
  assert.equal(compareSemver('0.6.0-rc.1', '0.6.0'), 0, 'prerelease игнорируется')
})

test('gte проверяет «не ниже» и невалидные стороны', () => {
  assert.equal(gte('0.6.0', '0.6.0'), true)
  assert.equal(gte('0.7.0', '0.6.0'), true)
  assert.equal(gte('0.5.0', '0.6.0'), false)
  assert.equal(gte('abc', '0.6.0'), false)
  assert.equal(gte('0.6.0', 'abc'), false)
})

test('isOlder проверяет «старше»', () => {
  assert.equal(isOlder('0.5.0', '0.6.0'), true)
  assert.equal(isOlder('0.6.0', '0.6.0'), false)
  assert.equal(isOlder('0.7.0', '0.6.0'), false)
  assert.equal(isOlder('abc', '0.6.0'), false)
})
