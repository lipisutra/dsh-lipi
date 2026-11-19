/**
 * `lipi_graph`: вернуть граф связей проекта, который вычислила установленная
 * команда `lipi check --structure`.
 * @module @lipisutra/dsh-lipi/tools/structure
 */
import { resolveProject } from '../project.js'
import { runCheck } from '../runner.js'

/** Largest amount of non-JSON lipi output kept for the model. */
const MAX_PARSE_STDOUT_BYTES = 8 * 1024

/** Fallback caps for nodes and edges when the configuration does not set them. */
const DEFAULT_MAX_NODES = 200
const DEFAULT_MAX_EDGES = 400

/** Node types `lipi check --structure` can emit; used to document the `types` filter. */
const NODE_TYPES = ['doc', 'work', 'anchor', 'code', 'rules', 'file']

const DESCRIPTION = [
  'Запускает установленную команду lipi (`lipi check --structure`) и возвращает граф связей',
  'проекта, развёрнутого по lipi: узлы (страницы описания,',
  'якоря, рабочие документы, файлы кода с метками @trace, правила) и рёбра (ссылки,',
  'метки, covers, ссылки мастер-плана). focus возвращает подграф вокруг узла с',
  'разделением входящих и исходящих рёбер и глубиной 1–3, orphans — недостижимые',
  'страницы и неиспользуемые якоря, uncovered — явные якоря без @trace, stale —',
  'цепочку устаревания по staged/diff. types фильтрует по типам узлов, format',
  'рендерит тот же подграф в mermaid или dot. Списки обрезаются после запроса;',
  'truncated и truncatedCount показывают обрезку. Нужны установленный lipi',
  '(`pipx install git+https://github.com/lipisutra/lipi`) и проект с lipi.json.',
].join(' ')

const PARAMETERS = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Корень проекта. По умолчанию — рабочая папка сессии; укажите путь, если она не внутри проекта или сервис рабочей папки недоступен.',
    },
    focus: {
      type: 'string',
      description: 'ID узла (путь файла, якорь или ID рабочего документа): вернуть подграф вокруг него — сам узел, соседи до глубины depth и рёбра между ними.',
    },
    depth: {
      type: 'integer',
      minimum: 1,
      maximum: 3,
      default: 1,
      description: 'Радиус подграфа для focus: 1–3. Первый шаг гарантируется, дальше — best-effort под лимитом.',
    },
    orphans: {
      type: 'boolean',
      description: 'Вернуть недостижимые страницы описания и якоря, на которые ничего не ссылается.',
    },
    uncovered: {
      type: 'boolean',
      description: 'Вернуть явные якоря (не заголовки) без входящей метки @trace. Отбор идёт до обрезки.',
    },
    types: {
      type: 'array',
      items: { type: 'string', enum: NODE_TYPES },
      description: 'Оставить узлы только этих типов и рёбра, чьи оба конца входят в результат. Применяется до обрезки.',
    },
    format: {
      type: 'string',
      enum: ['json', 'mermaid', 'dot'],
      default: 'json',
      description: 'Форма выдачи: json (по умолчанию), mermaid или dot — рендер того же подграфа.',
    },
    stale: {
      type: 'boolean',
      description: 'Вернуть цепочку устаревания: код под меткой `@trace` изменён в выбранном diff, а раздел описания — нет. Требует staged или diff.',
    },
    staged: {
      type: 'boolean',
      description: 'Для stale: считать расхождение по проиндексированным изменениям (git diff --cached).',
    },
    diff: {
      type: 'string',
      description: 'Для stale: считать расхождение по диапазону git, напр. "origin/main...HEAD".',
    },
  },
}

/**
 * Create the `lipi_graph` tool definition for one plugin context.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context; the working-directory service is read through `ctx.get`.
 * @param {{lipiPath: string, wslDistro: string, maxNodes: number, maxEdges: number}} cfg Valid bundle configuration.
 * @returns {object} A registry-ready tool definition.
 */
export function createStructureTool(ctx, cfg) {
  return {
    name: 'lipi_graph',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    /**
     * @param {{path?: string, focus?: string, depth?: number, orphans?: boolean, uncovered?: boolean, types?: string[], format?: string}} args Validated arguments.
     * @param {{agent?: {session: object}}} exec Execution context.
     * @returns {Promise<object>} Structure graph, render, parse fallback, or a tool-level error.
     */
    async execute(args, exec) {
      let project
      try {
        project = resolveProject(startDirectory(args, ctx, exec))
      } catch (error) {
        return withHint({ error: messageOf(error) }, cfg)
      }

      const staleRequested = typeof args?.stale === 'boolean' ? args.stale : false
      const graphViews = [args?.focus, args?.orphans, args?.uncovered]
      if (staleRequested && graphViews.some((v) => v === true || (typeof v === 'string' && v.trim() !== ''))) {
        return { root: project.root, error: 'несовместимые виды: stale не сочетается с focus, orphans, uncovered' }
      }
      let commandArgs = ['check', '--format', 'json', '--structure']
      if (staleRequested) {
        if (args?.staged === true) commandArgs = [...commandArgs, '--staged']
        else if (typeof args?.diff === 'string' && args.diff.trim() !== '') commandArgs = [...commandArgs, '--diff', args.diff.trim()]
        else return { root: project.root, error: 'для stale укажите staged: true или diff: "<range>"' }
      }

      let result
      try {
        result = runCheck(project, commandArgs, cfg)
      } catch (error) {
        return withHint({ error: messageOf(error) }, cfg)
      }
      const parsed = parseStructureResult(result.stdout, {
        root: project.root,
        exitCode: result.code,
        stderr: result.stderr,
      })
      if (parsed.parseError === true) return withHint(parsed, cfg)
      if (parsed.structure === null) {
        return withHint({ ...parsed, error: 'lipi не вернул structure — обновите установленный lipi (pipx upgrade lipi)' }, cfg)
      }

      if (staleRequested) {
        return { root: project.root, version: parsed.version, exitCode: parsed.exitCode, stale: parsed.structure.stale ?? [] }
      }

      const query = applyQuery(parsed.structure, args)
      if (query.error) {
        return { root: project.root, version: parsed.version, exitCode: parsed.exitCode, error: query.error }
      }

      const { nodes, edges, truncatedCount } = limitGraph(
        query.nodes, query.edges, cfg.maxNodes, cfg.maxEdges,
        query.protectedNodeIds, query.protectedEdgeIdxs,
      )

      const format = typeof args?.format === 'string' ? args.format : 'json'
      if (format === 'mermaid' || format === 'dot') {
        const diagram = format === 'mermaid' ? toMermaid(nodes, edges) : toDot(nodes, edges)
        return { root: project.root, version: parsed.version, exitCode: parsed.exitCode, format, diagram }
      }

      const structure = {
        nodes,
        edges,
        counts: parsed.structure.counts,
        resultCounts: countsOf(nodes, edges),
      }
      if (query.focus !== undefined) {
        structure.focus = query.focus
        structure.found = query.found
        if (!query.found) structure.suggestions = query.suggestions
        else {
          structure.incoming = query.incoming
          structure.outgoing = query.outgoing
        }
      }
      if (query.orphans) structure.orphans = true
      if (query.uncovered) structure.uncovered = true
      return {
        root: project.root,
        version: parsed.version,
        exitCode: parsed.exitCode,
        structure,
        truncated: truncatedCount > 0,
        truncatedCount,
      }
    },
  }
}

/**
 * Parse one `lipi check --structure` JSON document with a structure graph.
 * No slicing happens here: caps are applied after the requested view is chosen.
 * @param {string} stdout `lipi check --structure` standard output.
 * @param {{root: string, exitCode: number, stderr?: string}} options Exit code, project root, and stderr.
 * @returns {object} Parsed result with `structure` (`nodes`, `edges`, `counts`), or a non-JSON fallback.
 */
export function parseStructureResult(stdout, options) {
  const { root, exitCode, stderr = '' } = options
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { parseError: true, exitCode, stdout: truncateText(stdout.trim(), MAX_PARSE_STDOUT_BYTES), stderr }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { parseError: true, exitCode, stdout: truncateText(stdout.trim(), MAX_PARSE_STDOUT_BYTES), stderr }
  }
  const version = typeof parsed.version === 'string' ? parsed.version : null
  const raw = parsed.structure !== null && typeof parsed.structure === 'object' && !Array.isArray(parsed.structure)
    ? parsed.structure
    : null
  if (raw === null) return { root, version, exitCode, structure: null }
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const edges = Array.isArray(raw.edges) ? raw.edges : []
  const counts = raw.counts !== null && typeof raw.counts === 'object' ? raw.counts : countsOf(nodes, edges)
  const stale = Array.isArray(raw.stale) ? raw.stale : null
  return { root, version, exitCode, structure: { nodes, edges, counts, stale } }
}

/**
 * Choose the requested view over the full graph and mark the protected part.
 * @param {{nodes: object[], edges: object[], counts: object}} structure Parsed graph.
 * @param {{focus?: string, depth?: number, orphans?: boolean, uncovered?: boolean, types?: string[]}} args Tool arguments.
 * @returns {{nodes: object[], edges: object[], error?: string, focus?: string, found?: boolean, suggestions?: string[], incoming?: object[], outgoing?: object[], orphans?: boolean, uncovered?: boolean, protectedNodeIds?: Set<string>, protectedEdgeIdxs?: Set<number>}} Queried graph.
 */
export function applyQuery(structure, args) {
  const nodes = structure.nodes ?? []
  const edges = structure.edges ?? []
  const a = args !== null && typeof args === 'object' ? args : {}
  const views = []
  if (a.orphans === true) views.push('orphans')
  if (a.uncovered === true) views.push('uncovered')
  if (typeof a.focus === 'string' && a.focus.trim() !== '') views.push('focus')
  if (views.length > 1) {
    return { nodes: [], edges: [], error: `несовместимые виды: ${views.join(', ')} — укажите не более одного` }
  }

  let query
  if (a.orphans === true) query = orphanNodes(nodes, edges)
  else if (a.uncovered === true) query = uncoveredNodes(nodes, edges)
  else if (typeof a.focus === 'string' && a.focus.trim() !== '') {
    query = focusSubgraph(nodes, edges, a.focus.trim(), depthOf(a.depth))
  } else {
    query = { nodes, edges }
  }

  if (Array.isArray(a.types) && a.types.length > 0) {
    const allowed = new Set(a.types)
    const keptNodes = query.nodes.filter((n) => allowed.has(n.type))
    const ids = new Set(keptNodes.map((n) => n.id))
    const keptEdges = query.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    query = { ...query, nodes: keptNodes, edges: keptEdges }
  }

  if (query.focus !== undefined && query.found) {
    const protectedNodeIds = new Set([query.focus])
    const protectedEdgeIdxs = new Set()
    query.edges.forEach((e, i) => {
      if (e.from === query.focus || e.to === query.focus || e.anchor === query.focus) {
        protectedEdgeIdxs.add(i)
        if (typeof e.from === 'string') protectedNodeIds.add(e.from)
        if (typeof e.to === 'string') protectedNodeIds.add(e.to)
        if (typeof e.anchor === 'string') protectedNodeIds.add(e.anchor)
      }
    })
    query.protectedNodeIds = protectedNodeIds
    query.protectedEdgeIdxs = protectedEdgeIdxs
  }
  return query
}

/**
 * Cap a queried graph, keeping the protected part first.
 * @param {object[]} nodes Nodes to cap.
 * @param {object[]} edges Edges to cap.
 * @param {number} maxNodes Node cap.
 * @param {number} maxEdges Edge cap.
 * @param {Set<string>} [protectedNodeIds] Node ids that must survive the cap.
 * @param {Set<number>} [protectedEdgeIdxs] Edge indices that must survive the cap.
 * @returns {{nodes: object[], edges: object[], truncatedCount: number}} Capped graph and drop count.
 */
export function limitGraph(nodes, edges, maxNodes, maxEdges, protectedNodeIds, protectedEdgeIdxs) {
  const nodeLimit = Number.isInteger(maxNodes) && maxNodes > 0 ? maxNodes : DEFAULT_MAX_NODES
  const edgeLimit = Number.isInteger(maxEdges) && maxEdges > 0 ? maxEdges : DEFAULT_MAX_EDGES
  const pn = protectedNodeIds ?? new Set()
  const pe = protectedEdgeIdxs ?? new Set()
  const orderedNodes = [...nodes.filter((n) => pn.has(n.id)), ...nodes.filter((n) => !pn.has(n.id))]
  const orderedEdges = []
  edges.forEach((e, i) => { if (pe.has(i)) orderedEdges.push(e) })
  edges.forEach((e, i) => { if (!pe.has(i)) orderedEdges.push(e) })
  const keptNodes = orderedNodes.slice(0, nodeLimit)
  const keptEdges = orderedEdges.slice(0, edgeLimit)
  const truncatedCount = (nodes.length - keptNodes.length) + (edges.length - keptEdges.length)
  return { nodes: keptNodes, edges: keptEdges, truncatedCount }
}

/**
 * Subgraph around one node id up to a radius: the node itself, reachable
 * neighbours within `depth` hops, and edges whose both ends are kept.
 * `link` edges contribute their `anchor` node as an extra endpoint.
 * @param {object[]} nodes Parsed nodes.
 * @param {object[]} edges Parsed edges.
 * @param {string} focus Node id.
 * @param {number} depth Radius 1–3.
 * @returns {object} Narrowed graph with `focus`, `found`, `incoming`, `outgoing`.
 */
export function focusSubgraph(nodes, edges, focus, depth) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  if (!byId.has(focus)) {
    return { nodes: [], edges: [], focus, found: false, suggestions: suggest(nodes, focus) }
  }
  const adj = new Map()
  const link = (a, b, e) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push([b, e])
  }
  for (const e of edges) {
    link(e.from, e.to, e)
    link(e.to, e.from, e)
    if (e.anchor) {
      link(e.anchor, e.from, e)
      link(e.from, e.anchor, e)
      link(e.anchor, e.to, e)
      link(e.to, e.anchor, e)
    }
  }
  const dist = { [focus]: 0 }
  const queue = [focus]
  while (queue.length > 0) {
    const cur = queue.shift()
    if (dist[cur] >= depth) continue
    for (const [nb] of adj.get(cur) ?? []) {
      if (!(nb in dist)) {
        dist[nb] = dist[cur] + 1
        queue.push(nb)
      }
    }
  }
  const keep = new Set(Object.keys(dist))
  const keptNodes = nodes.filter((n) => keep.has(n.id))
  const keptEdges = edges.filter((e) => keep.has(e.from) && keep.has(e.to))
  const incoming = edges.filter((e) =>
    keep.has(e.from) && keep.has(e.to) && e.from !== focus && (e.to === focus || e.anchor === focus))
  const outgoing = edges.filter((e) =>
    keep.has(e.from) && keep.has(e.to) && e.from === focus && e.to !== focus)
  return { nodes: keptNodes, edges: keptEdges, focus, found: true, incoming, outgoing }
}

/**
 * Nodes that nothing reaches or uses: doc pages not reachable from the index,
 * and anchors no link, trace or covers edge references.
 * @param {object[]} nodes Parsed nodes.
 * @param {object[]} edges Parsed edges.
 * @returns {object} Narrowed graph with `orphans: true`.
 */
export function orphanNodes(nodes, edges) {
  const referenced = new Set()
  for (const e of edges) {
    if (e.type === 'trace' || e.type === 'covers') referenced.add(e.to)
    if (e.type === 'link' && typeof e.anchor === 'string') referenced.add(e.anchor)
  }
  const keptNodes = nodes.filter((n) =>
    (n.type === 'doc' && n.reachable === false) ||
    (n.type === 'anchor' && !referenced.has(n.id)))
  return { nodes: keptNodes, edges: [], orphans: true }
}

/**
 * Explicit anchors (no `slug` field) with no incoming `trace` edge.
 * @param {object[]} nodes Parsed nodes.
 * @param {object[]} edges Parsed edges.
 * @returns {object} Narrowed graph with `uncovered: true`.
 */
export function uncoveredNodes(nodes, edges) {
  const traced = new Set()
  for (const e of edges) {
    if (e.type === 'trace') traced.add(e.to)
  }
  const keptNodes = nodes.filter((n) => n.type === 'anchor' && !('slug' in n) && !traced.has(n.id))
  return { nodes: keptNodes, edges: [], uncovered: true }
}

/**
 * Per-type counts of a node/edge list.
 * @param {object[]} nodes Nodes.
 * @param {object[]} edges Edges.
 * @returns {{nodes: number, edges: number, nodeTypes: object, edgeTypes: object}} Counts.
 */
function countsOf(nodes, edges) {
  const nodeTypes = {}
  const edgeTypes = {}
  for (const n of nodes) nodeTypes[n.type] = (nodeTypes[n.type] ?? 0) + 1
  for (const e of edges) edgeTypes[e.type] = (edgeTypes[e.type] ?? 0) + 1
  return { nodes: nodes.length, edges: edges.length, nodeTypes, edgeTypes }
}

/**
 * Candidate node ids that resemble a missed focus target.
 * @param {object[]} nodes Parsed nodes.
 * @param {string} focus Missed id.
 * @returns {string[]} Up to five candidates.
 */
function suggest(nodes, focus) {
  const f = focus.toLowerCase()
  return nodes.map((n) => n.id)
    .filter((id) => id.toLowerCase().includes(f))
    .slice(0, 5)
}

/**
 * Turn a tool `depth` argument into a radius.
 * @param {number | undefined} depth Requested depth.
 * @returns {number} Radius clamped to 1–3.
 */
function depthOf(depth) {
  if (Number.isInteger(depth) && depth >= 1 && depth <= 3) return depth
  return 1
}

/**
 * Render a subgraph as a Mermaid flowchart.
 * @param {object[]} nodes Nodes.
 * @param {object[]} edges Edges.
 * @returns {string} Mermaid source.
 */
export function toMermaid(nodes, edges) {
  const byId = new Map(nodes.map((n, i) => [n.id, i]))
  const lines = ['flowchart LR']
  nodes.forEach((n, i) => {
    lines.push(`  n${i}["${escapeLabel(n.id)} (${n.type})"]`)
  })
  for (const e of edges) {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (from === undefined || to === undefined) continue
    const label = e.anchor ? `${e.type}:${e.anchor}` : e.type
    lines.push(`  n${from} -->|${escapeLabel(label)}| n${to}`)
  }
  return lines.join('\n')
}

/**
 * Render a subgraph as a Graphviz DOT digraph.
 * @param {object[]} nodes Nodes.
 * @param {object[]} edges Edges.
 * @returns {string} DOT source.
 */
export function toDot(nodes, edges) {
  const byId = new Map(nodes.map((n, i) => [n.id, i]))
  const lines = ['digraph G {']
  nodes.forEach((n, i) => {
    lines.push(`  n${i} [label="${escapeLabel(n.id)}\\n(${n.type})"];`)
  })
  for (const e of edges) {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (from === undefined || to === undefined) continue
    const label = e.anchor ? `${e.type}:${e.anchor}` : e.type
    lines.push(`  n${from} -> n${to} [label="${escapeLabel(label)}"];`)
  }
  lines.push('}')
  return lines.join('\n')
}

/**
 * Escape a label for a diagram line.
 * @param {string} text Raw label.
 * @returns {string} Escaped label.
 */
function escapeLabel(text) {
  return String(text).replaceAll('\\', '\\\\').replaceAll('"', '&quot;').replaceAll('\n', ' ')
}

/**
 * Resolve the directory discovery starts from.
 * @param {{path?: string}} args Tool arguments.
 * @param {import('@deepseek-ai/cordis').Context} ctx Plugin context.
 * @param {{agent?: {session: object}}} exec Execution context.
 * @returns {string} Explicit path, or the session working directory.
 */
function startDirectory(args, ctx, exec) {
  if (typeof args.path === 'string' && args.path.trim() !== '') return args.path
  const workingDirectory = ctx.get('workingDirectory')
  const session = exec.agent?.session
  if (workingDirectory !== undefined && session !== undefined) {
    const directory = workingDirectory.get(session)
    if (typeof directory === 'string' && directory !== '') return directory
  }
  throw new Error('не удалось определить рабочую папку сессии: сервис working directory недоступен — укажите path явно')
}

/**
 * Add the configured lipi installation path to an error result.
 * @param {object} result Error result.
 * @param {{lipiPath: string}} cfg Bundle configuration.
 * @returns {object} The same result, with `hint` when a path is configured.
 */
function withHint(result, cfg) {
  if (typeof cfg.lipiPath !== 'string' || cfg.lipiPath === '') return result
  return { ...result, hint: `Проверьте путь к установленному lipi (lipiPath): ${cfg.lipiPath}` }
}

/**
 * Keep at most `maxBytes` bytes of UTF-8 text, without splitting a character.
 * @param {string} text Source text.
 * @param {number} maxBytes Byte budget.
 * @returns {string} The whole text, or its longest UTF-8-safe prefix.
 */
function truncateText(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let result = ''
  let size = 0
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (size + bytes > maxBytes) break
    result += character
    size += bytes
  }
  return result
}

/**
 * Render an unknown thrown value as text.
 * @param {unknown} error Thrown value.
 * @returns {string} Its message or string form.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
