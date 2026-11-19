import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  applyQuery,
  createStructureTool,
  focusSubgraph,
  limitGraph,
  orphanNodes,
  parseStructureResult,
  toDot,
  toMermaid,
  uncoveredNodes,
} from '../src/tools/structure.js'
import { canRunFakeLipi, createFakeLipi, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu', maxNodes: 200, maxEdges: 400 }

/**
 * Create a deployed project directory with `lipi.json`.
 * @returns {string} Absolute project root.
 */
function deployProject() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-structure-tool-')))
  writeFileSync(join(root, 'lipi.json'), '{"docs": "docs", "workflow": "workflow"}')
  return root
}

/**
 * Build a plugin context whose working directory is `root`.
 * @param {string} root Project root.
 * @returns {object} Minimal Cordis-like context.
 */
function contextWith(root) {
  return {
    get(name) {
      return name === 'workingDirectory' ? { get: () => root } : undefined
    },
  }
}

/** Execution context for tool calls. */
const EXEC = { agent: { session: {} } }

/**
 * Build one structure node.
 * @param {string} id Node id.
 * @param {string} type Node type.
 * @param {object} [extra] Additional fields.
 * @returns {{id: string, type: string}} Node.
 */
function node(id, type, extra = {}) {
  return { id, type, ...extra }
}

const STRUCTURE = {
  nodes: [
    node('docs/README.md', 'doc', { reachable: true, anchors: ['a1'] }),
    node('docs/guide.md', 'doc', { reachable: true }),
    node('a1', 'anchor', { path: 'docs/README.md', line: 1 }),
    node('docs/guide.md#intro', 'anchor', { path: 'docs/guide.md', line: 5, slug: 'intro' }),
    node('src/x.py', 'code'),
    node('PLN-001', 'work'),
  ],
  edges: [
    { from: 'docs/README.md', to: 'docs/guide.md', type: 'link', line: 2 },
    { from: 'docs/README.md', to: 'docs/guide.md', type: 'link', line: 3, anchor: 'docs/guide.md#intro' },
    { from: 'a1', to: 'docs/README.md', type: 'anchor', line: 1 },
    { from: 'src/x.py', to: 'a1', type: 'trace', line: 3 },
  ],
  counts: { nodes: 6, edges: 4 },
}

test('parseStructureResult разбирает JSON и не обрезает раньше запроса', () => {
  const result = parseStructureResult(JSON.stringify({ schema: 1, version: '1.0.0', structure: STRUCTURE }), {
    root: '/srv/app',
    exitCode: 0,
  })
  assert.equal(result.root, '/srv/app')
  assert.equal(result.version, '1.0.0')
  assert.equal(result.structure.nodes.length, 6)
  assert.equal(result.structure.edges.length, 4)
  assert.deepEqual(result.structure.counts, STRUCTURE.counts)
  assert.equal(result.truncated, undefined)
})

test('parseStructureResult без structure возвращает structure: null', () => {
  const result = parseStructureResult(JSON.stringify({ schema: 1, version: '1.0.0', errors: [], warnings: [] }), {
    root: '/srv/app',
    exitCode: 0,
  })
  assert.equal(result.structure, null)
})

test('parseStructureResult сохраняет stale-цепочку', () => {
  const stale = [{ file: 'src/x.py', line: 3, anchor: 'a1', page: 'docs/README.md', covers: [], works: [] }]
  const result = parseStructureResult(JSON.stringify({ schema: 1, version: '1.0.0', structure: { ...STRUCTURE, stale } }), {
    root: '/srv/app',
    exitCode: 0,
  })
  assert.deepEqual(result.structure.stale, stale)
})

test('parseStructureResult возвращает parseError для не-JSON', () => {
  const result = parseStructureResult('не json', { root: '/srv/app', exitCode: 1 })
  assert.equal(result.parseError, true)
})

test('applyQuery без видов возвращает весь граф', () => {
  const result = applyQuery(STRUCTURE, {})
  assert.equal(result.nodes.length, 6)
  assert.equal(result.edges.length, 4)
})

test('applyQuery focus возвращает подграф с входящими и исходящими', () => {
  const result = applyQuery(STRUCTURE, { focus: 'a1' })
  assert.equal(result.focus, 'a1')
  assert.equal(result.found, true)
  assert.ok(result.nodes.some((n) => n.id === 'a1'))
  assert.ok(result.edges.some((e) => e.type === 'trace' && e.to === 'a1'))
  assert.ok(result.edges.some((e) => e.type === 'anchor' && e.from === 'a1'))
  assert.ok(result.incoming.some((e) => e.type === 'trace'))
  assert.ok(result.outgoing.some((e) => e.type === 'anchor'))
})

test('applyQuery focus по slug-узлу находит рёбра ссылок', () => {
  const result = applyQuery(STRUCTURE, { focus: 'docs/guide.md#intro' })
  assert.equal(result.found, true)
  assert.ok(result.edges.some((e) => e.type === 'link' && e.anchor === 'docs/guide.md#intro'))
  assert.ok(result.incoming.some((e) => e.type === 'link' && e.anchor === 'docs/guide.md#intro'))
})

test('applyQuery focus с промахом даёт подсказки', () => {
  const result = applyQuery(STRUCTURE, { focus: 'intro' })
  assert.equal(result.found, false)
  assert.ok(result.suggestions.includes('docs/guide.md#intro'))
})

test('applyQuery depth 2 расширяет подграф', () => {
  const result = applyQuery(STRUCTURE, { focus: 'docs/README.md', depth: 2 })
  assert.ok(result.nodes.some((n) => n.id === 'src/x.py'))
})

test('applyQuery отклоняет несовместимые виды', () => {
  const result = applyQuery(STRUCTURE, { focus: 'a1', orphans: true })
  assert.ok(result.error)
})

test('applyQuery types фильтрует узлы и рёбра', () => {
  const result = applyQuery(STRUCTURE, { types: ['anchor'] })
  assert.ok(result.nodes.every((n) => n.type === 'anchor'))
  assert.ok(result.edges.every((e) =>
    result.nodes.some((n) => n.id === e.from) && result.nodes.some((n) => n.id === e.to)))
})

test('orphans возвращает недостижимые и неиспользуемые узлы', () => {
  const orphanDoc = { id: 'docs/orphan.md', type: 'doc', reachable: false }
  const unusedAnchor = { id: 'zz', type: 'anchor', path: 'docs/README.md', line: 9 }
  const result = orphanNodes(
    [...STRUCTURE.nodes, orphanDoc, unusedAnchor],
    STRUCTURE.edges,
  )
  assert.ok(result.nodes.some((n) => n.id === 'docs/orphan.md'))
  assert.ok(result.nodes.some((n) => n.id === 'zz'))
  assert.ok(!result.nodes.some((n) => n.id === 'a1'), 'используемый якорь не должен попасть в сироты')
})

test('uncovered возвращает только явные якоря без trace', () => {
  const result = uncoveredNodes(
    [...STRUCTURE.nodes, node('b2', 'anchor', { path: 'docs/guide.md', line: 9 })],
    STRUCTURE.edges,
  )
  assert.deepEqual(result.nodes.map((n) => n.id), ['b2'])
})

test('limitGraph сохраняет защищённые узлы и рёбра', () => {
  const { nodes, edges, truncatedCount } = limitGraph(
    STRUCTURE.nodes, STRUCTURE.edges, 2, 2,
    new Set(['a1', 'src/x.py']), new Set([3]),
  )
  assert.ok(nodes.some((n) => n.id === 'a1'))
  assert.ok(nodes.some((n) => n.id === 'src/x.py'))
  assert.ok(edges.some((e) => e.type === 'trace'))
  assert.equal(truncatedCount, (6 - 2) + (4 - 2))
})

test('toMermaid и toDot рендерят одинаковый набор узлов', () => {
  const mermaid = toMermaid(STRUCTURE.nodes, STRUCTURE.edges)
  const dot = toDot(STRUCTURE.nodes, STRUCTURE.edges)
  assert.match(mermaid, /flowchart LR/)
  assert.match(dot, /digraph G/)
  for (const n of STRUCTURE.nodes) {
    assert.ok(mermaid.includes(n.id), `mermaid не содержит ${n.id}`)
    assert.ok(dot.includes(n.id), `dot не содержит ${n.id}`)
  }
})

test('focusSubgraph с глубиной 1 не уходит дальше соседей', () => {
  const result = focusSubgraph(STRUCTURE.nodes, STRUCTURE.edges, 'a1', 1)
  assert.ok(result.nodes.some((n) => n.id === 'src/x.py'))
  assert.ok(!result.nodes.some((n) => n.id === 'PLN-001'))
})

test('lipi_graph запускает установленную команду check --format json --structure', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: JSON.stringify({ schema: 1, version: '1.0.1', errors: [], warnings: [], structure: STRUCTURE }) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createStructureTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({}, EXEC))
  assert.equal(result.root, root)
  assert.equal(result.version, '1.0.1')
  assert.equal(result.structure.nodes.length, 6)
  assert.equal(result.structure.edges.length, 4)
  assert.deepEqual(fake.arguments(), ['check', '--format', 'json', '--structure'])
})

test('lipi_graph передаёт staged для stale-цепочки', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const stale = [{ file: 'src/x.py', line: 3, anchor: 'a1', page: 'docs/README.md', covers: [], works: [] }]
  const fake = createFakeLipi({ stdout: JSON.stringify({ schema: 1, version: '1.0.1', structure: { ...STRUCTURE, stale } }) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createStructureTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({ stale: true, staged: true }, EXEC))
  assert.deepEqual(result.stale, stale)
  assert.deepEqual(fake.arguments(), ['check', '--format', 'json', '--structure', '--staged'])
})

test('lipi_graph сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const tool = createStructureTool(contextWith(root), cfg)
  const result = await tool.execute({}, EXEC)
  assert.match(result.error, /команда lipi не найдена/)
})
