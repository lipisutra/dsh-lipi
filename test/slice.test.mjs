import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { createSliceTool, parseSliceResult, SLICE_BLOCKS, sliceArguments } from '../src/tools/slice.js'
import { canRunFakeLipi, createFakeLipi, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu' }

/**
 * Create a deployed project directory with `lipi.json`.
 * @returns {string} Absolute project root.
 */
function deployProject() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-slice-tool-')))
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

/** Slice of a page: concepts and context, no marks on the page. */
const PAGE_SLICE = {
  schema: 1,
  target: { target: 'docs/README.md', title: 'Документация', kind: 'page', found: 'exact' },
  summary: { errors: 0, warnings: 0, decisions: 0, rules: 0, concepts: 2, entry: 0, code: 0, layers: 0, tests: 0, open_work: 0, targets: 0 },
  blocks: [
    {
      kind: 'concepts',
      items: [
        { target: 'docs/README.md#by-question', title: 'Найти по вопросу', code_count: 0 },
        { target: 'docs/README.md#start', title: 'С чего начать', code_count: 0 },
      ],
      omitted: 0,
      hint: [],
    },
    {
      kind: 'context',
      items: [{ target: 'AGENTS.md', title: 'Точки входа', relation: 'link', depth: 1 }],
      omitted: 0,
      hint: [],
    },
  ],
  incomplete: false,
  notes: [{ code: 'no-marks', text: 'меток нет — ищите по коду' }],
  checks: { staleness: { state: 'full', checked: 0, total: 0 } },
}

/** Slice of a code file: signals, decisions, concepts, tests, and cut code places. */
const CODE_SLICE = {
  schema: 1,
  target: { target: 'src/domain/discount.py', title: 'файл кода', kind: 'code', layer: 'domain', found: 'exact' },
  summary: { errors: 0, warnings: 1, decisions: 1, rules: 1, concepts: 1, entry: 2, code: 4, layers: 2, tests: 3, open_work: 0, targets: 0 },
  blocks: [
    {
      kind: 'signals',
      items: [{
        code: 'T3',
        level: 'warning',
        message: 'ISS-004 закрыто — обход больше не нужен',
        target: 'ISS-004',
        path: 'src/domain/discount.py',
        line: 80,
      }],
      omitted: 0,
      hint: [],
    },
    {
      kind: 'obey',
      items: [{ target: 'ADR-018', title: 'Скидка считается от суммы без доставки', relation: 'mark', status: 'принято' }],
      omitted: 0,
      hint: [],
    },
    {
      kind: 'concepts',
      items: [{ target: 'docs/pricing.md#threshold', title: 'Порог', code_count: 5 }],
      omitted: 0,
      hint: [],
    },
    {
      kind: 'tests',
      items: [{ path: 'tests/test_discount.py', line: 8, symbol: 'def test_threshold_boundary():', layer: 'tests' }],
      omitted: 0,
      hint: [],
    },
    {
      kind: 'code',
      items: [
        { path: 'src/app/settings.py', line: 21, symbol: 'DISCOUNT_THRESHOLD = Money(10_000)', layer: 'app' },
        { path: 'src/domain/discount.py', line: 12, symbol: 'class DiscountPolicy:', layer: 'domain' },
      ],
      omitted: 2,
      hint: ['--only code', '--layer'],
    },
  ],
  incomplete: true,
  notes: [{ code: 'staleness-partial', text: 'устаревание проверено для 1 из 3 мест; полная проверка — lipi audit' }],
  checks: { staleness: { state: 'partial', checked: 1, total: 3 } },
}

/** Slice of a work document: status and one open issue signal. */
const WORK_SLICE = {
  schema: 1,
  target: {
    target: 'PLN-006',
    title: 'Переход бандла на lipi 4.x',
    kind: 'work',
    status: 'новый',
    found: 'exact',
  },
  summary: { errors: 0, warnings: 0, decisions: 0, rules: 0, concepts: 0, entry: 0, code: 0, layers: 0, tests: 0, open_work: 1, targets: 0 },
  blocks: [{
    kind: 'signals',
    items: [{
      code: null,
      level: 'info',
      message: 'ISS-001 открыто — Справочники расходятся (ссылается на цель)',
      target: 'ISS-001',
    }],
    omitted: 0,
    hint: [],
  }],
  incomplete: false,
  notes: [{ code: 'work-empty', text: 'работа ни на что не ссылается и меток на неё нет' }],
  checks: { staleness: { state: 'full', checked: 0, total: 0 } },
}

/** Slice of a section with a cut excerpt. */
const EXCERPT_SLICE = {
  schema: 1,
  target: { target: 'docs/pricing.md#threshold', title: 'Скидка 5%', kind: 'section', found: 'exact' },
  summary: { errors: 0, warnings: 0, decisions: 1, rules: 0, concepts: 0, entry: 0, code: 0, layers: 0, tests: 0, open_work: 0, targets: 0 },
  blocks: [
    {
      kind: 'obey',
      items: [{ target: 'ADR-018', title: 'Скидка считается от суммы без доставки', relation: 'link' }],
      omitted: 0,
      hint: [],
    },
    {
      kind: 'excerpt',
      items: [{ text: 'Скидка 5% действует с суммы заказа.\nСумма сравнивается после округления.', lines: 2, cut: true }],
      omitted: 3,
      hint: ['--full'],
    },
  ],
  incomplete: true,
  notes: [],
  checks: { staleness: { state: 'full', checked: 0, total: 0 } },
}

/** Slice by changed code: target kind `diff`, related concepts, diff checks. */
const DIFF_SLICE = {
  schema: 1,
  target: { target: '--diff HEAD', title: 'проверьте связанные места', kind: 'diff', found: 'exact' },
  summary: { errors: 0, warnings: 0, decisions: 1, rules: 0, concepts: 1, entry: 0, code: 0, layers: 0, tests: 0, open_work: 0, targets: 0 },
  blocks: [
    {
      kind: 'obey',
      items: [{ target: 'ADR-018', title: 'Скидка считается от суммы без доставки', relation: 'mark', status: 'принято' }],
      omitted: 0,
      hint: [],
    },
    {
      kind: 'concepts',
      items: [{ target: 'slice.md#exit', title: 'Коды возврата', code_count: 1 }],
      omitted: 0,
      hint: [],
    },
  ],
  incomplete: false,
  notes: [
    { code: 'diff-review', text: 'проверьте связанные места, решения и тесты' },
    { code: 'diff-unmarked', text: 'изменения без меток: 0 мест' },
  ],
  checks: { staleness: { state: 'full', checked: 0, total: 0 }, diff: { mode: 'diff', base: 'HEAD', files: 2, unmarked: 0 } },
}

/** Slice by staged changes: the same answer with `--staged` in the target. */
const STAGED_SLICE = {
  ...DIFF_SLICE,
  target: { target: '--staged', title: 'проверьте связанные места', kind: 'diff', found: 'exact' },
  checks: { staleness: { state: 'full', checked: 0, total: 0 }, diff: { mode: 'staged', base: null, files: 2, unmarked: 0 } },
}

/**
 * Join a fixture as the command's stdout.
 * @param {object} value JSON document.
 * @returns {string} Serialized JSON.
 */
function json(value) {
  return JSON.stringify(value)
}

test('sliceArguments строит argv с целью и форматом json', () => {
  assert.deepEqual(sliceArguments('docs/README.md', {}), ['slice', 'docs/README.md', '--format', 'json'])
  assert.deepEqual(sliceArguments('  PLN-006  '), ['slice', 'PLN-006', '--format', 'json'])
})

test('sliceArguments передаёт флаги в argv в устойчивом порядке', () => {
  const args = sliceArguments('docs/README.md', {
    full: true,
    depth: 2,
    layer: ['app', 'src'],
    only: ['concepts', 'context'],
  })
  assert.deepEqual(args, [
    'slice', 'docs/README.md', '--format', 'json',
    '--full', '--depth', '2', '--layer', 'app', '--layer', 'src', '--only', 'concepts,context',
  ])
})

test('sliceArguments принимает одиночную строку для layer и only', () => {
  assert.deepEqual(sliceArguments('PLN-006', { layer: 'domain', only: 'signals, concepts' }), [
    'slice', 'PLN-006', '--format', 'json', '--layer', 'domain', '--only', 'signals,concepts',
  ])
})

test('sliceArguments отвергает пустую цель и неверную глубину', () => {
  assert.throws(() => sliceArguments('   ', {}), /цель среза не указана/)
  assert.throws(() => sliceArguments(undefined, {}), /цель среза не указана/)
  assert.throws(() => sliceArguments('docs/README.md', { depth: 4 }), /глубина среза — 2 или 3/)
})

test('sliceArguments передаёт цель и источник изменений в argv', () => {
  assert.deepEqual(sliceArguments('docs/README.md', { diff: 'origin/main...HEAD' }), [
    'slice', 'docs/README.md', '--diff', 'origin/main...HEAD', '--format', 'json',
  ])
  assert.deepEqual(sliceArguments('docs/README.md', { staged: true }), [
    'slice', 'docs/README.md', '--staged', '--format', 'json',
  ])
})

test('sliceArguments пропускает цель в срезе по изменениям', () => {
  assert.deepEqual(sliceArguments(undefined, { diff: 'HEAD' }), ['slice', '--diff', 'HEAD', '--format', 'json'])
  assert.deepEqual(sliceArguments('   ', { staged: true }), ['slice', '--staged', '--format', 'json'])
  assert.deepEqual(sliceArguments(undefined, { diff: ' HEAD ', depth: 2, only: 'signals' }), [
    'slice', '--diff', 'HEAD', '--format', 'json', '--depth', '2', '--only', 'signals',
  ])
})

test('sliceArguments отвергает diff и staged одновременно', () => {
  assert.throws(
    () => sliceArguments(undefined, { diff: 'HEAD', staged: true }),
    /срез по изменениям: --diff и --staged вместе не задаются/,
  )
  assert.throws(
    () => sliceArguments('PLN-006', { diff: 'HEAD', staged: true }),
    /срез по изменениям: --diff и --staged вместе не задаются/,
  )
})

test('parseSliceResult разбирает срез страницы и печатает блоки', () => {
  const result = parseSliceResult(json(PAGE_SLICE), 0)
  assert.equal(result.error, undefined)
  assert.equal(result.schema, 1)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.target, PAGE_SLICE.target)
  assert.equal(result.incomplete, false)
  assert.deepEqual(result.checks, PAGE_SLICE.checks)
  const lines = result.text.split('\n')
  assert.equal(lines[0], 'docs/README.md — Документация [page, exact]')
  assert.equal(lines[1], '2 понятия')
  assert.equal(lines[2], 'меток нет — ищите по коду')
  assert.equal(lines[3], '')
  assert.equal(lines[4], 'Понятия')
  assert.equal(lines[5], '  docs/README.md#by-question — Найти по вопросу (0 мест в коде)')
  assert.equal(lines[6], '  docs/README.md#start — С чего начать (0 мест в коде)')
  assert.equal(lines[7], 'Контекст')
  assert.equal(lines[8], '  AGENTS.md — Точки входа')
  assert.equal(lines.length, 9)
})

test('parseSliceResult печатает сигналы, тесты, места в коде и обрезку', () => {
  const result = parseSliceResult(json(CODE_SLICE), 0)
  const lines = result.text.split('\n')
  assert.equal(lines[0], 'src/domain/discount.py — файл кода [code, exact, слой: domain]')
  assert.equal(lines[1], '1 предупреждение · 1 решение · 1 правило · 1 понятие · 2 точки входа · 4 места в коде (2 слоя) · 3 теста')
  assert.equal(lines[2], 'устаревание проверено для 1 из 3 мест; полная проверка — lipi audit')
  assert.ok(result.text.includes('! T3  src/domain/discount.py:80 — ISS-004 закрыто — обход больше не нужен'))
  assert.ok(result.text.includes('ADR-018 принято — Скидка считается от суммы без доставки (mark)'))
  assert.ok(result.text.includes('docs/pricing.md#threshold — Порог (5 мест в коде)'))
  assert.ok(result.text.includes('tests/test_discount.py:8  def test_threshold_boundary():'))
  assert.ok(result.text.includes('src/app/settings.py:21  DISCOUNT_THRESHOLD = Money(10_000)  [app]'))
  assert.ok(result.text.includes('показано 2 из 4; ещё — --only code, --layer'))
  assert.ok(result.text.includes('\nнеполно: часть сведений скрыта или проверена не полностью'))
})

test('parseSliceResult печатает срез работы со статусом и открытой работой', () => {
  const result = parseSliceResult(json(WORK_SLICE), 0)
  const lines = result.text.split('\n')
  assert.equal(lines[0], 'PLN-006 — Переход бандла на lipi 4.x [work, exact, новый]')
  assert.equal(lines[1], '1 открытая работа')
  assert.equal(lines[2], 'работа ни на что не ссылается и меток на неё нет')
  assert.ok(result.text.includes('Сигналы'))
  assert.ok(result.text.includes('· ISS-001 открыто — Справочники расходятся (ссылается на цель)'))
})

test('parseSliceResult печатает выдержку и её обрезку', () => {
  const result = parseSliceResult(json(EXCERPT_SLICE), 0)
  assert.ok(result.text.includes('Понятие\n  Скидка 5% действует с суммы заказа.\n  Сумма сравнивается после округления.'))
  assert.ok(result.text.includes('обрезано; показано 2 из 5 строк; ещё — --full'))
  assert.ok(result.text.includes('\nнеполно:'))
})

test('parseSliceResult печатает срез по диффу с видом цели diff', () => {
  const result = parseSliceResult(json(DIFF_SLICE), 0)
  const lines = result.text.split('\n')
  assert.equal(result.error, undefined)
  assert.equal(lines[0], '--diff HEAD — проверьте связанные места [diff, exact]')
  assert.equal(lines[1], '1 решение · 1 понятие')
  assert.equal(lines[2], 'проверьте связанные места, решения и тесты')
  assert.equal(lines[3], 'изменения без меток: 0 мест')
  assert.ok(result.text.includes('ADR-018 принято — Скидка считается от суммы без доставки (mark)'))
  assert.ok(result.text.includes('slice.md#exit — Коды возврата (1 место в коде)'))
  assert.deepEqual(result.checks.diff, { mode: 'diff', base: 'HEAD', files: 2, unmarked: 0 })
})

test('parseSliceResult печатает срез по staged с тем же видом цели', () => {
  const result = parseSliceResult(json(STAGED_SLICE), 0)
  assert.equal(result.error, undefined)
  assert.match(result.text, /^--staged — проверьте связанные места \[diff, exact\]/)
  assert.deepEqual(result.checks.diff, { mode: 'staged', base: null, files: 2, unmarked: 0 })
})

test('parseSliceResult берёт кандидатов из JSON при not-found', () => {
  const result = parseSliceResult(json({ schema: 1, error: 'not-found', query: 'работ', candidates: [] }), 1)
  assert.equal(result.exitCode, 1)
  assert.match(result.error, /цель «работ» не найдена/)
  assert.equal(result.query, 'работ')
  assert.deepEqual(result.candidates, [])
})

test('parseSliceResult берёт кандидатов из JSON при ambiguous', () => {
  const candidates = [
    { target: 'PLN-001', title: 'Виджет проверки lipi в интерфейсе DSH' },
    { target: '.agents/README.md#checks', title: 'Проверки перед коммитом' },
  ]
  const result = parseSliceResult(json({ schema: 1, error: 'ambiguous', query: 'проверк', candidates }), 1)
  assert.equal(result.exitCode, 1)
  assert.match(result.error, /цель «проверк» неоднозначна/)
  assert.deepEqual(result.candidates, candidates)
})

test('parseSliceResult берёт кандидатов из текста, если JSON нет', () => {
  const stdout = [
    'цель «проверк» неоднозначна; кандидаты:',
    '  PLN-001 — Виджет проверки lipi в интерфейсе DSH',
    '  .agents/README.md#checks — Проверки перед коммитом',
  ].join('\n')
  const result = parseSliceResult(stdout, 1)
  assert.match(result.error, /неоднозначна/)
  assert.deepEqual(result.candidates, [
    { target: 'PLN-001', title: 'Виджет проверки lipi в интерфейсе DSH' },
    { target: '.agents/README.md#checks', title: 'Проверки перед коммитом' },
  ])
})

test('parseSliceResult разбирает текстовую форму not-found', () => {
  const result = parseSliceResult('цель «no-such» не найдена', 1)
  assert.equal(result.error, 'цель «no-such» не найдена')
  assert.deepEqual(result.candidates, [])
})

test('parseSliceResult сообщает о неверных аргументах из stderr', () => {
  const result = parseSliceResult('', 2, { stderr: 'usage: lipi slice [-h]\nlipi slice: error: unrecognized arguments: --wat\n' })
  assert.equal(result.error, 'неверные аргументы или настройки')
  assert.equal(result.exitCode, 2)
  assert.match(result.details, /unrecognized arguments: --wat/)
})

test('parseSliceResult берёт C1 из JSON при ошибке настроек', () => {
  const report = {
    schema: 1,
    version: '1.0.0',
    errors: [{ code: 'C1', file: 'lipi.json', line: 0, subject: '', message: 'ключ «slice_budget»: ожидается целое от 1, а не 0' }],
    warnings: [],
    summary: { pages: 0, docs: 0, tags: 0, errors: 1, warnings: 0 },
  }
  const result = parseSliceResult(json(report), 2)
  assert.equal(result.error, 'неверные аргументы или настройки')
  assert.match(result.details, /slice_budget/)
})

test('parseSliceResult терпим к новым ключам и новым видам блоков', () => {
  const future = {
    ...PAGE_SLICE,
    future_top: { nested: true },
    target: { ...PAGE_SLICE.target, future_attr: 'x' },
    summary: { ...PAGE_SLICE.summary, future_metric: 7 },
    blocks: [
      ...PAGE_SLICE.blocks.map((block) => ({
        ...block,
        future_flag: true,
        items: block.items.map((item) => ({ ...item, future_value: 1 })),
      })),
      {
        kind: 'future',
        items: [{ target: 'docs/future.md', title: 'Будущее' }],
        omitted: 0,
        hint: [],
        future_block_key: 'ok',
      },
    ],
    notes: [...PAGE_SLICE.notes, { code: 'future-note', text: 'новое примечание' }],
    checks: { ...PAGE_SLICE.checks, future: true },
  }
  const result = parseSliceResult(json(future), 0)
  assert.equal(result.error, undefined)
  assert.equal(result.blocks.length, 3)
  assert.ok(result.text.includes('новое примечание'))
  assert.ok(result.text.includes('future\n  docs/future.md — Будущее'))
  assert.ok(result.text.includes('docs/README.md#start — С чего начать (0 мест в коде)'))
})

test('parseSliceResult допускает отсутствие необязательных полей цели', () => {
  const result = parseSliceResult(json({ schema: 1, target: { target: 'docs/README.md' }, summary: {}, blocks: [] }), 0)
  assert.equal(result.error, undefined)
  assert.equal(result.text, 'docs/README.md')
})

test('parseSliceResult строг к отсутствию обязательных полей', () => {
  const full = { schema: 1, target: { target: 'docs/README.md' }, summary: {}, blocks: [] }
  for (const field of ['schema', 'target', 'summary', 'blocks']) {
    const broken = { ...full }
    delete broken[field]
    const result = parseSliceResult(json(broken), 0)
    assert.match(result.error, /неожиданный ответ lipi slice/)
    assert.match(result.error, new RegExp(field))
  }
  const noTargetName = parseSliceResult(json({ schema: 1, target: { title: 'без пути' }, summary: {}, blocks: [] }), 0)
  assert.match(noTargetName.error, /target\.target/)
})

test('parseSliceResult отвергает неизвестную схему среза', () => {
  const result = parseSliceResult(json({ schema: 2, target: { target: 'docs/README.md' }, summary: {}, blocks: [] }), 0)
  assert.match(result.error, /неподдерживаемая схема среза: 2/)
})

test('parseSliceResult сообщает о не-JSON ответе и неизвестном коде', () => {
  assert.match(parseSliceResult('Traceback (most recent call last):\n', 0).error, /не JSON/)
  assert.match(parseSliceResult('boom', 3).error, /кодом 3/)
})

test('parseSliceResult печатает пустой срез с примечанием', () => {
  const empty = {
    schema: 1,
    target: { target: 'src/tools/check.js', title: 'файл кода', kind: 'code', layer: 'src', found: 'exact' },
    summary: { errors: 0, warnings: 0, decisions: 0, rules: 0, concepts: 0, entry: 0, code: 0, layers: 0, tests: 0, open_work: 0, targets: 0 },
    blocks: [],
    incomplete: false,
    notes: [{ code: 'file-no-marks', text: 'в файле нет меток — понятия неизвестны, ищите по коду' }],
    checks: { staleness: { state: 'full', checked: 0, total: 0 } },
  }
  const result = parseSliceResult(json(empty), 0)
  assert.equal(result.error, undefined)
  assert.deepEqual(result.blocks, [])
  assert.equal(result.text, [
    'src/tools/check.js — файл кода [code, exact, слой: src]',
    'в файле нет меток — понятия неизвестны, ищите по коду',
  ].join('\n'))
})

test('lipi_slice запускает установленную команду slice и отдаёт текст', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: json(PAGE_SLICE) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createSliceTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({ target: 'docs/README.md' }, EXEC))
  assert.equal(result.error, undefined)
  assert.match(result.text, /^docs\/README\.md — Документация \[page, exact\]/)
  assert.deepEqual(fake.arguments(), ['slice', 'docs/README.md', '--format', 'json'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('lipi_slice передаёт флаги команде slice', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: json(WORK_SLICE) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createSliceTool(contextWith(root), CFG)
  await withFakePath(fake.dir, () => tool.execute({
    target: 'PLN-006',
    full: true,
    depth: 3,
    layer: ['domain', 'app'],
    only: ['signals'],
  }, EXEC))
  assert.deepEqual(fake.arguments(), [
    'slice', 'PLN-006', '--format', 'json',
    '--full', '--depth', '3', '--layer', 'domain', '--layer', 'app', '--only', 'signals',
  ])
})

test('lipi_slice запускает slice --diff без цели', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: json(DIFF_SLICE) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createSliceTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({ diff: 'HEAD' }, EXEC))
  assert.equal(result.error, undefined)
  assert.match(result.text, /^--diff HEAD — проверьте связанные места \[diff, exact\]/)
  assert.ok(result.text.includes('изменения без меток: 0 мест'))
  assert.deepEqual(fake.arguments(), ['slice', '--diff', 'HEAD', '--format', 'json'])
})

test('lipi_slice запускает slice --staged без цели', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: json(STAGED_SLICE) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createSliceTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({ staged: true }, EXEC))
  assert.equal(result.error, undefined)
  assert.match(result.text, /^--staged — проверьте связанные места \[diff, exact\]/)
  assert.deepEqual(fake.arguments(), ['slice', '--staged', '--format', 'json'])
})

test('lipi_slice отвергает diff и staged одновременно', async () => {
  const root = deployProject()
  try {
    const tool = createSliceTool(contextWith(root), CFG)
    const result = await tool.execute({ diff: 'HEAD', staged: true }, EXEC)
    assert.match(result.error, /срез по изменениям: --diff и --staged вместе не задаются/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lipi_slice сообщает об неоднозначной цели с кандидатами', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const candidates = [
    { target: 'PLN-001', title: 'Виджет проверки lipi в интерфейсе DSH' },
    { target: '.agents/README.md#checks', title: 'Проверки перед коммитом' },
  ]
  const fake = createFakeLipi({ stdout: json({ schema: 1, error: 'ambiguous', query: 'проверк', candidates }), exitCode: 1 })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createSliceTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({ target: 'проверк' }, EXEC))
  assert.match(result.error, /неоднозначна/)
  assert.deepEqual(result.candidates, candidates)
})

test('lipi_slice сообщает о неверных аргументах и настройках', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: '', stderr: 'lipi slice: error: unrecognized arguments: --wat\n', exitCode: 2 })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createSliceTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({ target: 'docs/README.md' }, EXEC))
  assert.equal(result.error, 'неверные аргументы или настройки')
  assert.match(result.details, /unrecognized arguments/)
})

test('lipi_slice требует цель среза', async () => {
  const root = deployProject()
  try {
    const tool = createSliceTool(contextWith(root), CFG)
    const result = await tool.execute({}, EXEC)
    assert.match(result.error, /цель среза не указана/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('lipi_slice подсказывает про установку, когда команды lipi нет', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const tool = createSliceTool(contextWith(root), cfg)
  const result = await tool.execute({ target: 'docs/README.md' }, EXEC)
  assert.match(result.error, /команда lipi не найдена/)
  assert.match(result.error, /pipx install git\+https:\/\/github\.com\/lipisutra\/lipi/)
})

test('SLICE_PARAMETERS не требует цель и принимает diff/staged', () => {
  const tool = createSliceTool(contextWith('/tmp'), CFG)
  assert.equal(tool.parameters.required, undefined)
  assert.equal(tool.parameters.properties.target.type, 'string')
  assert.equal(tool.parameters.properties.diff.type, 'string')
  assert.match(tool.parameters.properties.diff.description, /связи изменённого кода/)
  assert.equal(tool.parameters.properties.staged.type, 'boolean')
  assert.match(tool.parameters.properties.staged.description, /git diff --cached/)
})

test('SLICE_BLOCKS перечисляет блоки контракта среза', () => {
  assert.deepEqual(SLICE_BLOCKS, ['signals', 'obey', 'excerpt', 'concepts', 'entry', 'code', 'tests', 'targets', 'context'])
})
