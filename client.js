/**
 * Client half of @lipisutra/dsh-lipi: a compact pill in the composer dock that
 * shows the current session project's lipi check result and runs the checker
 * through the host commands `/lipi-check`, `/lipi-slice`, `/lipi-map`,
 * `/lipi-init`, `/lipi-doctor` and `/lipi-lang`. Actions and details live in a
 * portaled dialog with the native dock surface. Its position is captured once
 * when it opens and frozen in viewport coordinates (the check command echoes a
 * line into the chat, which lifts the composer and would drag an
 * anchor-following panel with it).
 *
 * Data flow: the widget reads the session working directory with `useSessions`,
 * sends it to the host command via `ctx.remote.commands.execute`, and renders
 * the result the command returns — JSON for a check, a slice, a coverage map or
 * the language state, plain output for init and doctor. No model is involved.
 *
 * Language: all visible strings live in `STRINGS`; the widget asks lipi for its
 * language with `/lipi-lang` on load and when the panel opens and keeps the
 * answer in one page-wide cache, which the chat tool cards also read.
 */
window.__ModuleLoader__.load({
  id: '@lipisutra/dsh-lipi',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const TONES = {
      idle: '#9aa0a6',
      loading: '#fbbf24',
      clean: '#22c55e',
      errors: '#ef4444',
      warnings: '#f59e0b',
      failed: '#ef4444',
    }
    /**
     * Пользовательские строки виджета и карточек. `en` — основа и запасной
     * словарь, `ru` — полный перевод. Язык берётся у lipi через `/lipi-lang`;
     * неизвестный код показывает `en`, чтобы панель не оставалась пустой.
     */
    const STRINGS = {
      en: {
        app: 'lipi',
        errors: {
          notFound: 'command not found',
          noResult: 'command returned no result',
          unparsed: 'could not parse the result',
          commandFailed: 'command failed',
        },
        dock: {
          noCwd: 'lipi: no working directory',
          statusAria: 'lipi status and actions',
          toggleTitle: (summary) => `${summary} — show lipi actions`,
          checking: 'checking…',
          notChecked: 'not checked yet',
          version: (version) => `lipi ${version}`,
          counts: (errors, warnings) => `errors: ${errors} · warnings: ${warnings}`,
          badgeClean: 'clean',
          more: (count) => `… ${count} more`,
          baseline: (known, fixed) => `baseline ${known}, fixed ${fixed}`,
        },
        modes: { quick: 'Check', staged: 'With drift (staged)', audit: 'Audit' },
        actions: {
          update: 'Update project',
          updateTitle: 'Update the project: lipi init applies the rules and migrates materials to the installed version',
          updateConfirm: 'Update for sure?',
          updateConfirmTitle: 'Apply the installed lipi rules (lipi init)',
          updatePlan: 'What changes',
          updatePlanTitle: 'Show what lipi init would change without writing anything',
          deploy: 'Deploy lipi',
          deployTitle: 'Deploy lipi in the working directory',
          deployConfirm: 'Deploy for sure?',
          deployConfirmTitle: 'Confirm lipi init in the working directory',
          cancel: 'Cancel',
          cancelUpdateTitle: 'Cancel the update',
          cancelDeployTitle: 'Cancel the deployment',
        },
        slice: {
          caption: 'Slice',
          placeholder: 'target: section, page, file or number',
          aria: 'lipi slice target',
          run: 'Slice',
          runTitle: 'Run lipi slice for the target',
          full: 'full text',
          staged: 'by changes (staged)',
          doctor: 'Diagnostics',
          doctorTitle: 'Run lipi doctor',
        },
        map: {
          button: 'Map',
          title: 'Coverage map',
          runTitle: 'Run lipi map for the working directory',
          layers: 'Layers',
          code: 'code',
          tests: 'tests',
          targetFallback: '(target)',
          empty: 'no coverage rows',
          incomplete: 'incomplete: part of the data is hidden or not fully checked',
        },
        lang: { label: 'Language', aria: 'lipi interface language' },
        output: { diagnostics: 'Diagnostics', deploy: 'Deployment', plan: 'Migration plan' },
        blocks: {
          signals: 'Signals',
          obey: 'Obey',
          excerpt: 'Concept',
          concepts: 'Concepts',
          entry: 'Entry points',
          code: 'Code locations',
          tests: 'Tests',
          targets: 'Work targets',
          context: 'Context',
        },
        sliceResult: {
          targetFallback: '(target)',
          foundExact: 'exact',
          foundPrefix: 'found: ',
          layerPrefix: 'layer: ',
          omitted: (count) => `hidden ${count}`,
          omittedMore: (hints) => `; more — ${hints}`,
          incomplete: 'incomplete: part of the data is hidden or not fully checked',
          blockFallback: 'block',
        },
        plurals: {
          error: { one: 'error', few: 'errors', many: 'errors' },
          warning: { one: 'warning', few: 'warnings', many: 'warnings' },
          decision: { one: 'decision', few: 'decisions', many: 'decisions' },
          rule: { one: 'rule', few: 'rules', many: 'rules' },
          concept: { one: 'concept', few: 'concepts', many: 'concepts' },
          entry: { one: 'entry point', few: 'entry points', many: 'entry points' },
          code: { one: 'code location', few: 'code locations', many: 'code locations' },
          layer: { one: 'layer', few: 'layers', many: 'layers' },
          test: { one: 'test', few: 'tests', many: 'tests' },
          openWork: { one: 'open work item', few: 'open work items', many: 'open work items' },
          target: { one: 'target', few: 'targets', many: 'targets' },
          page: { one: 'description page', few: 'description pages', many: 'description pages' },
          doc: { one: 'work document', few: 'work documents', many: 'work documents' },
          tag: { one: 'tag', few: 'tags', many: 'tags' },
        },
        cards: {
          titles: {
            lipi_check: 'lipi check',
            lipi_slice: 'lipi slice',
            lipi_new: 'lipi document',
            lipi_graph: 'lipi graph',
            lipi_map: 'lipi map',
          },
          phase: { preparing: 'preparing…', start: 'running…' },
          version: (version) => `lipi ${version}`,
          collapse: 'Collapse',
          expand: 'Show details',
          findings: 'Findings',
          noFindings: 'no findings',
          truncated: (count) => `lists truncated: ${count} more`,
          baselineHint: (known, fixed) => `baseline ${known}, fixed ${fixed} — `,
          baselineCommand: 'lipi baseline --prune',
          severity: { error: 'error', warning: 'warning' },
          error: 'error',
          exitCode: (code) => `exit code: ${code}`,
          noResult: 'no result',
          unparsed: 'output not recognized',
          unparsedHint: 'result text shown as is',
          created: 'created: ',
          number: (id) => `number: ${id}`,
          indexUpdated: 'work materials index updated',
          indexNotUpdated: 'work materials index was not updated',
          layers: 'Layers',
          emptyGraph: 'the graph has no nodes or edges',
          mapEmpty: 'no coverage rows',
          mapIncomplete: 'incomplete: part of the data is hidden or not fully checked',
          notJson: 'lipi printed non-JSON',
          notJsonHint: 'check the installed lipi version: pipx upgrade lipi',
          toolFailed: 'the tool failed',
          graphNodes: (count) => `nodes: ${count}`,
          graphEdges: (count) => `edges: ${count}`,
          graphFocus: (focus) => `focus: ${focus}`,
          graphNotFound: 'not found',
          graphOrphans: 'orphans',
          graphUncovered: 'without labels',
          graphStale: (count) => `staleness: ${count}`,
          graphNoStale: 'no staleness',
          graphHidden: (count) => `hidden: ${count}`,
          graphFormat: (format) => `format: ${format}`,
          graphDiagram: 'diagram',
          graphLines: (count) => `lines: ${count}`,
        },
      },
      ru: {
        app: 'lipi',
        errors: {
          notFound: 'команда не найдена',
          noResult: 'команда не вернула результат',
          unparsed: 'не удалось разобрать результат',
          commandFailed: 'команда завершилась ошибкой',
        },
        dock: {
          noCwd: 'lipi: нет рабочей папки',
          statusAria: 'Статус lipi и действия',
          toggleTitle: (summary) => `${summary} — показать действия lipi`,
          checking: 'проверяю…',
          notChecked: 'ещё не проверялось',
          version: (version) => `lipi ${version}`,
          counts: (errors, warnings) => `ошибок: ${errors} · предупреждений: ${warnings}`,
          badgeClean: 'чисто',
          more: (count) => `… ещё ${count}`,
          baseline: (known, fixed) => `в базовой линии ${known}, исправлено ${fixed}`,
        },
        modes: { quick: 'Проверить', staged: 'С расхождением (staged)', audit: 'Аудит' },
        actions: {
          update: 'Обновить проект',
          updateTitle: 'Обновить проект: lipi init применит правила и переведёт материалы установленной версией',
          updateConfirm: 'Точно обновить?',
          updateConfirmTitle: 'Применить правила установленного lipi (lipi init)',
          updatePlan: 'Что изменится',
          updatePlanTitle: 'Показать, что изменит lipi init, ничего не записывая',
          deploy: 'Развернуть lipi',
          deployTitle: 'Развернуть lipi в рабочей папке',
          deployConfirm: 'Точно развернуть?',
          deployConfirmTitle: 'Подтвердить lipi init в рабочей папке',
          cancel: 'Отмена',
          cancelUpdateTitle: 'Отменить обновление',
          cancelDeployTitle: 'Отменить развёртывание',
        },
        slice: {
          caption: 'Срез',
          placeholder: 'цель: раздел, страница, файл или номер',
          aria: 'Цель среза lipi',
          run: 'Срез',
          runTitle: 'Запустить lipi slice по цели',
          full: 'полный текст',
          staged: 'по изменениям (staged)',
          doctor: 'Диагностика',
          doctorTitle: 'Запустить lipi doctor',
        },
        map: {
          button: 'Карта',
          title: 'Карта покрытия',
          runTitle: 'Запустить lipi map для рабочей папки',
          layers: 'Слои',
          code: 'код',
          tests: 'тесты',
          targetFallback: '(цель)',
          empty: 'строк покрытия нет',
          incomplete: 'неполно: часть сведений скрыта или проверена не полностью',
        },
        lang: { label: 'Язык', aria: 'Язык интерфейса lipi' },
        output: { diagnostics: 'Диагностика', deploy: 'Развёртывание', plan: 'План перехода' },
        blocks: {
          signals: 'Сигналы',
          obey: 'Соблюдать',
          excerpt: 'Понятие',
          concepts: 'Понятия',
          entry: 'С чего начинать',
          code: 'Места в коде',
          tests: 'Тесты',
          targets: 'Цели работы',
          context: 'Контекст',
        },
        sliceResult: {
          targetFallback: '(цель)',
          foundExact: 'exact',
          foundPrefix: 'найдено: ',
          layerPrefix: 'слой: ',
          omitted: (count) => `скрыто ${count}`,
          omittedMore: (hints) => `; ещё — ${hints}`,
          incomplete: 'неполно: часть сведений скрыта или проверена не полностью',
          blockFallback: 'блок',
        },
        plurals: {
          error: { one: 'ошибка', few: 'ошибки', many: 'ошибок' },
          warning: { one: 'предупреждение', few: 'предупреждения', many: 'предупреждений' },
          decision: { one: 'решение', few: 'решения', many: 'решений' },
          rule: { one: 'правило', few: 'правила', many: 'правил' },
          concept: { one: 'понятие', few: 'понятия', many: 'понятий' },
          entry: { one: 'точка входа', few: 'точки входа', many: 'точек входа' },
          code: { one: 'место в коде', few: 'места в коде', many: 'мест в коде' },
          layer: { one: 'слой', few: 'слоя', many: 'слоёв' },
          test: { one: 'тест', few: 'теста', many: 'тестов' },
          openWork: { one: 'открытая работа', few: 'открытые работы', many: 'открытых работ' },
          target: { one: 'цель', few: 'цели', many: 'целей' },
          page: { one: 'страница описания', few: 'страницы описания', many: 'страниц описания' },
          doc: { one: 'рабочий документ', few: 'рабочих документа', many: 'рабочих документов' },
          tag: { one: 'метка', few: 'метки', many: 'меток' },
        },
        cards: {
          titles: {
            lipi_check: 'Проверка lipi',
            lipi_slice: 'Срез lipi',
            lipi_new: 'Документ lipi',
            lipi_graph: 'Граф lipi',
            lipi_map: 'Карта lipi',
          },
          phase: { preparing: 'подготовка…', start: 'выполняется…' },
          version: (version) => `lipi ${version}`,
          collapse: 'Свернуть',
          expand: 'Показать подробности',
          findings: 'Находки',
          noFindings: 'находок нет',
          truncated: (count) => `списки обрезаны: ещё ${count}`,
          baselineHint: (known, fixed) => `в базовой линии ${known}, исправлено ${fixed} — `,
          baselineCommand: 'lipi baseline --prune',
          severity: { error: 'ошибка', warning: 'предупреждение' },
          error: 'ошибка',
          exitCode: (code) => `код возврата: ${code}`,
          noResult: 'результата нет',
          unparsed: 'вывод не распознан',
          unparsedHint: 'показан текст результата как есть',
          created: 'создан: ',
          number: (id) => `номер: ${id}`,
          indexUpdated: 'указатель рабочих материалов обновлён',
          indexNotUpdated: 'указатель рабочих материалов не обновлялся',
          layers: 'Слои',
          emptyGraph: 'в графе нет узлов и рёбер',
          mapEmpty: 'строк покрытия нет',
          mapIncomplete: 'неполно: часть сведений скрыта или проверена не полностью',
          notJson: 'lipi напечатал не JSON',
          notJsonHint: 'проверьте установленную версию lipi: pipx upgrade lipi',
          toolFailed: 'инструмент завершился ошибкой',
          graphNodes: (count) => `узлов: ${count}`,
          graphEdges: (count) => `рёбер: ${count}`,
          graphFocus: (focus) => `focus: ${focus}`,
          graphNotFound: 'не найдено',
          graphOrphans: 'сироты',
          graphUncovered: 'без меток',
          graphStale: (count) => `устаревание: ${count}`,
          graphNoStale: 'устаревания нет',
          graphHidden: (count) => `скрыто: ${count}`,
          graphFormat: (format) => `формат: ${format}`,
          graphDiagram: 'диаграмма',
          graphLines: (count) => `строк: ${count}`,
        },
      },
    }

    /** Подписи языковых кодов: код — основа, имя только для удобства выбора. */
    const LANG_NAMES = { en: 'English', ru: 'Русский' }

    /** Режимы проверки: подписи берутся из словаря, флаги — у команды. */
    const MODES = [
      { id: 'quick', flag: '' },
      { id: 'staged', flag: ' --staged' },
      { id: 'audit', flag: ' --audit' },
    ]

    /** Части сводки среза: поле ответа и ключ существительного в `plurals`. */
    const SUMMARY_PARTS = [
      ['errors', 'error'],
      ['warnings', 'warning'],
      ['decisions', 'decision'],
      ['rules', 'rule'],
      ['concepts', 'concept'],
      ['entry', 'entry'],
      ['code', 'code'],
      ['tests', 'test'],
      ['open_work', 'openWork'],
      ['targets', 'target'],
    ]

    const PANEL_WIDTH = 360

    /** Заголовки блоков среза из всех словарей → вид блока (разбор текста lipi). */
    const BLOCK_KINDS_BY_TITLE = {}
    for (const dictionary of Object.values(STRINGS)) {
      for (const [kind, title] of Object.entries(dictionary.blocks)) BLOCK_KINDS_BY_TITLE[title] = kind
    }

    /**
     * Общий кэш языка на страницу: один ответ `/lipi-lang` обслуживает и
     * виджет в доке, и карточки инструментов в чате.
     */
    const LANG = { current: 'en', available: ['en'] }
    const langListeners = new Set()

    /** Текущее состояние языка для компонентов. */
    function langSnapshot() {
      return { current: LANG.current, available: LANG.available.slice() }
    }

    /** Словарь по языковому коду с запасным `en`. */
    function stringsFor(code) {
      return Object.prototype.hasOwnProperty.call(STRINGS, code) ? STRINGS[code] : STRINGS.en
    }

    /** Понятная подпись языка для переключателя. */
    function languageLabel(code) {
      return LANG_NAMES[code] ?? String(code).toUpperCase()
    }

    /**
     * Применить ответ `/lipi-lang` (`{current, available}`) к общему кэшу.
     * @param {unknown} value Разобранный ответ хоста.
     */
    function applyLangState(value) {
      if (value === null || typeof value !== 'object') return
      const current = typeof value.current === 'string' && value.current !== '' ? value.current : LANG.current
      const available = Array.isArray(value.available)
        ? value.available.filter((code) => typeof code === 'string' && code !== '')
        : LANG.available
      const nextAvailable = available.length > 0 ? available : [current]
      const changed = current !== LANG.current || nextAvailable.join('\n') !== LANG.available.join('\n')
      LANG.current = current
      LANG.available = nextAvailable
      if (!changed) return
      for (const listener of [...langListeners]) listener()
    }

    /** Подписка компонента на смену языка; возвращает отписку. */
    function subscribeLang(listener) {
      langListeners.add(listener)
      return () => langListeners.delete(listener)
    }

    /** Язык в компоненте: снимок общего кэша и подписка на изменения. */
    function useLang() {
      const [snapshot, setSnapshot] = React.useState(langSnapshot)
      React.useEffect(() => subscribeLang(() => setSnapshot(langSnapshot())), [])
      return snapshot
    }

    // Один общий стиль на страницу: статические правила панели и пилюли.
    // Позицию панели задаёт инлайн-стиль: координаты окна, замороженные
    // при открытии (panelBox).
    let stylesInjected = false
    function ensureStyles() {
      if (stylesInjected || typeof document === 'undefined') return
      stylesInjected = true
      const style = document.createElement('style')
      style.id = 'dsh-lipi-widget-css'
      style.textContent = `
.dsh-lipi-pill {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  corner-shape: round;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-lipi-pill svg {
  width: 14px;
  height: 14px;
  flex: none;
}
.dsh-lipi-pill:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dsh-lipi-pill:disabled {
  cursor: default;
  opacity: 0.45;
}
@media (hover: hover) {
  .dsh-lipi-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-lipi-pill[aria-expanded='true'] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dsh-lipi-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: 1px solid var(--dsw-specific-menu, Canvas);
  flex: none;
  transition: background-color 150ms;
}
.dsh-lipi-panel {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  width: max-content;
  min-width: min(300px, calc(100vw - 24px));
  max-width: min(440px, calc(100vw - 24px));
  padding: 16px;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
  max-height: calc(100dvh - 12px - max(12px, var(--dsh-frame-overlay-top, 12px)));
  overflow-x: hidden;
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  height: fit-content;
  margin: 0;
}
.dsh-lipi-title { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 8px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-lipi-title-value { font-variant-numeric: tabular-nums; }
.dsh-lipi-badge { display: inline-flex; align-items: center; gap: 6px; padding: 1px 8px; border-radius: 999px; border: 0.5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 400; }
.dsh-lipi-badge-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.dsh-lipi-finding { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; overflow: hidden; }
.dsh-lipi-chip { flex: none; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 16px; border: 0.5px solid var(--dsw-alias-border-l1); }
.dsh-lipi-finding-loc { flex: none; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-lipi-finding-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary-dimmed, var(--dsw-alias-label-secondary)); }
.dsh-lipi-rule { margin-bottom: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-lipi-status { margin-bottom: 8px; color: var(--dsw-alias-label-primary-dimmed, var(--dsw-alias-label-secondary)); overflow-wrap: anywhere; white-space: pre-wrap; }
.dsh-lipi-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.dsh-lipi-action {
  font: inherit; font-size: 12px; cursor: pointer;
  padding: 2px 10px; border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-primary);
}
.dsh-lipi-action:disabled { cursor: default; opacity: 0.45; }
@media (hover: hover) {
  .dsh-lipi-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-lipi-slice { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.dsh-lipi-input {
  flex: 1 1 auto; min-width: 0; box-sizing: border-box;
  font: inherit; font-size: 12px; line-height: 16px;
  padding: 3px 8px; border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-primary);
}
.dsh-lipi-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-input:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -1px;
}
.dsh-lipi-flags { align-items: center; gap: 10px; }
.dsh-lipi-check {
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer; user-select: none; color: var(--dsw-alias-label-secondary);
}
.dsh-lipi-check input { margin: 0; accent-color: var(--dsw-alias-state-business-primary); }
.dsh-lipi-target { margin-bottom: 6px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dsh-lipi-summary { margin-bottom: 6px; overflow-wrap: anywhere; }
.dsh-lipi-section { margin-top: 8px; }
.dsh-lipi-block-title { margin-top: 6px; color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-lipi-slice-item { padding: 1px 0; overflow-wrap: anywhere; }
.dsh-lipi-pre {
  margin: 4px 0 0; padding: 4px 6px; max-height: 160px; overflow: auto;
  border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover);
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px; line-height: 16px;
  white-space: pre-wrap; overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
}
.dsh-lipi-list { margin: 0; padding: 0; list-style: none; }
.dsh-lipi-item {
  padding: 2px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dsh-lipi-hint { margin-top: 8px; color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-card {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
}
.dsh-lipi-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px;
}
.dsh-lipi-card-mark { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-card-mark svg { display: block; width: 14px; height: 14px; }
.dsh-lipi-card-head-main { display: flex; flex: 1 1 auto; flex-direction: column; gap: 1px; min-width: 0; }
.dsh-lipi-card-head-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; row-gap: 2px; min-width: 0; }
.dsh-lipi-card-title { color: var(--dsw-alias-label-primary); font-weight: 500; white-space: nowrap; }
.dsh-lipi-card-sub {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-lipi-badge {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto;
  min-width: 0; max-width: 100%;
  padding: 0 6px; border: 0.5px solid currentColor; border-radius: 999px;
  font-size: 11px; line-height: 16px; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dsh-lipi-badge-dot { flex: none; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.dsh-lipi-badge-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dsh-lipi-card-toggle {
  display: grid; place-items: center; flex: none;
  width: 20px; height: 20px; padding: 0;
  border: none; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-lipi-card-toggle svg { width: 12px; height: 12px; transition: transform 120ms; }
.dsh-lipi-card-toggle[aria-expanded='true'] svg { transform: rotate(180deg); }
.dsh-lipi-card-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -1px;
}
@media (hover: hover) {
  .dsh-lipi-card-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}
.dsh-lipi-card-body {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-lipi-card-row { min-width: 0; overflow-wrap: anywhere; }
.dsh-lipi-card-section { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-lipi-card-section-title { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-lipi-card-path {
  font: inherit; font-size: 12px; line-height: inherit;
  margin: 0; padding: 0; border: none; border-radius: 2px; background: transparent;
  color: var(--dsw-alias-label-primary);
  text-decoration: underline;
  text-decoration-color: var(--dsw-alias-border-l2);
  text-underline-offset: 2px;
  text-align: left; cursor: pointer; overflow-wrap: anywhere;
}
.dsh-lipi-card-path:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
@media (hover: hover) {
  .dsh-lipi-card-path:hover { text-decoration-color: currentColor; }
}
.dsh-lipi-card-mono,
.dsh-lipi-card-code {
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
}
.dsh-lipi-card-code { color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-card-mono {
  margin: 0; padding: 4px 6px; max-height: 220px; overflow: auto;
  border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover);
  line-height: 16px; white-space: pre-wrap; overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
}
.dsh-lipi-card-hint { color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dsh-lipi-card-error { color: var(--dsw-alias-state-error, #ef4444); font-weight: 500; overflow-wrap: anywhere; }
.dsh-lipi-card-empty { color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-lang { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dsh-lipi-lang-label { color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-lang { position: relative; flex: none; }
.dsh-lipi-lang-pill { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 12px; line-height: 16px; padding: 1px 8px; border-radius: 999px; border: 0.5px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; text-transform: uppercase; }
.dsh-lipi-lang-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-lipi-lang-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 5; min-width: 132px; padding: 2px 0; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter); border: 0.5px solid var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); }
.dsh-lipi-lang-option { display: block; width: 100%; text-align: left; font: inherit; font-size: 12px; line-height: 20px; padding: 2px 10px; border: none; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.dsh-lipi-lang-option:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-lipi-lang-option-current { color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; color: var(--dsw-alias-label-primary-dimmed, var(--dsw-alias-label-secondary)); overflow-wrap: anywhere; white-space: pre-wrap; }
.dsh-lipi-caption { margin: 10px 0 4px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dsh-lipi-lang-select {
  font: inherit; font-size: 12px; line-height: 16px;
  padding: 1px 6px; border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dsh-lipi-lang-select:disabled { cursor: default; opacity: 0.45; }
.dsh-lipi-lang-select:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -1px;
}
`
      document.head.appendChild(style)
    }

    /**
     * Panel placement in viewport coordinates, computed once when the panel
     * opens: prefers above the icon, flips below when space is short, clamps
     * horizontally into the viewport. The position is frozen after that —
     * layout changes in the chat must not drag the panel around.
     */
    function panelBox(rect) {
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 16)
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      const gap = 8
      const spaceAbove = rect.top - gap
      const spaceBelow = window.innerHeight - rect.bottom - gap
      if (spaceAbove >= 160 || spaceAbove >= spaceBelow) {
        return { left, width, bottom: window.innerHeight - rect.top + gap, maxHeight: Math.min(400, spaceAbove) }
      }
      return { left, width, top: rect.bottom + gap, maxHeight: Math.min(400, spaceBelow) }
    }

    /** Tone of a check state: dot color. Non-check states keep the last check's tone. */
    function toneOf(state) {
      if (state.kind === 'loading') return 'loading'
      if (state.kind === 'error') return 'failed'
      if (state.kind !== 'done') return 'idle'
      const errors = state.summary?.errors ?? 0
      const warnings = state.summary?.warnings ?? 0
      if (errors > 0) return 'errors'
      if (warnings > 0) return 'warnings'
      return 'clean'
    }

    /** Русское согласование числительных: 1 ошибка, 2 ошибки, 5 ошибок. */
    function plural3(n, one, few, many) {
      const n10 = n % 10, n100 = n % 100
      return n10 === 1 && n100 !== 11 ? one : n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? few : many
    }

    /** Число с существительным из словаря `plurals`: 1 error, 2 errors. */
    function countText(t, number, key) {
      const forms = (t.plurals && t.plurals[key]) || STRINGS.en.plurals[key]
      if (forms === undefined) return String(number)
      return `${number} ${plural3(number, forms.one, forms.few, forms.many)}`
    }

    /** Слои карты: имена из массива (строки или объекты `{name}`). */
    function normalizeMapLayers(value) {
      if (!Array.isArray(value)) return []
      const layers = []
      for (const item of value) {
        const name = typeof item === 'string' ? item : isRecord(item) ? textField(item.name) : ''
        if (name !== '' && !layers.includes(name)) layers.push(name)
      }
      return layers
    }

    /** Одна строка карты: цель, заголовок, вид, статус и счётчики по слоям. */
    function normalizeMapRow(item, layers) {
      const data = isRecord(item) ? item : {}
      const raw = isRecord(data.code) ? data.code : {}
      const code = {}
      for (const layer of layers) code[layer] = countField(raw[layer]) ?? 0
      for (const [layer, value] of Object.entries(raw)) {
        const number = countField(value)
        if (number !== null) code[layer] = number
      }
      const total = Object.values(code).reduce((sum, number) => sum + number, 0)
      const target = textField(data.target)
      return {
        target,
        title: textField(data.title),
        kind: textField(data.kind),
        status: textField(data.status),
        code,
        codeTotal: total,
        tests: countField(data.tests) ?? 0,
        path: target !== '' && looksLikePath(target) ? cleanPath(target) : '',
      }
    }

    /** Ответ `/lipi-map` и карточки `lipi_map`: `{layers, note, rows}` → общая модель. */
    function normalizeMapValue(value) {
      if (!isRecord(value)) return null
      const layers = normalizeMapLayers(value.layers)
      const rows = (Array.isArray(value.rows) ? value.rows : []).filter(isRecord).map((item) => normalizeMapRow(item, layers))
      const extra = []
      for (const row of rows) {
        for (const layer of Object.keys(row.code)) if (!layers.includes(layer) && !extra.includes(layer)) extra.push(layer)
      }
      const allLayers = [...layers, ...extra]
      for (const row of rows) {
        for (const layer of allLayers) if (typeof row.code[layer] !== 'number') row.code[layer] = 0
        row.codeTotal = allLayers.reduce((sum, layer) => sum + row.code[layer], 0)
      }
      return {
        kind: 'map',
        layers: allLayers,
        rows,
        note: textField(value.note),
        incomplete: value.incomplete === true,
      }
    }

    /** Сводка карты: сколько целей и слоёв. */
    function mapSummaryLine(map, t) {
      return `${countText(t, map.rows.length, 'target')} · ${countText(t, map.layers.length, 'layer')}`
    }

    /** Итоги кода по слоям: `api: 1 · domain: 0`. */
    function mapLayerLine(map) {
      const totals = {}
      for (const layer of map.layers) totals[layer] = 0
      for (const row of map.rows) {
        for (const [layer, count] of Object.entries(row.code)) totals[layer] = (totals[layer] ?? 0) + count
      }
      return map.layers.map((layer) => `${layer}: ${totals[layer] ?? 0}`).join(' · ')
    }

    /** Строка карты: «цель — заголовок [kind, status]: код N, тесты M». */
    function mapRowLine(row, t) {
      const target = row.target !== '' ? row.target : t.map.targetFallback
      const title = row.title !== '' ? `${target} — ${row.title}` : target
      const attrs = [row.kind, row.status].filter((part) => typeof part === 'string' && part !== '')
      const head = attrs.length > 0 ? `${title} [${attrs.join(', ')}]` : title
      return `${head}: ${t.map.code} ${row.codeTotal}, ${t.map.tests} ${row.tests}`
    }

    /**
     * Человекочитаемая строка карты из card-рендера:
     * «цель — заголовок [kind, status]: код N (api 1), тесты M».
     */
    function parseMapRowLine(line) {
      const counts = /:\s*(?:код|code)\s+(\d+)(?:\s*\(([^)]*)\))?,\s*(?:тесты|tests)\s+(\d+)\s*$/i.exec(line)
      if (counts === null) return null
      const head = line.slice(0, counts.index).trim()
      const bracket = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(head)
      const main = bracket === null ? head : bracket[1].trim()
      const attrs = bracket === null
        ? []
        : bracket[2].split(',').map((part) => part.trim()).filter((part) => part !== '')
      const dash = /^(.+?)\s+—\s+(.+)$/.exec(main)
      const target = dash === null ? main : dash[1].trim()
      const title = dash === null ? '' : dash[2].trim()
      if (target === '') return null
      const code = {}
      if (typeof counts[2] === 'string') {
        for (const part of counts[2].split(',')) {
          const pair = /^\s*(\S+)\s+(\d+)\s*$/.exec(part)
          if (pair !== null) code[pair[1]] = Number(pair[2])
        }
      }
      return {
        target,
        title,
        kind: attrs.length > 1 ? attrs[0] : '',
        status: attrs.length > 1 ? attrs[1] : attrs[0] ?? '',
        code,
        codeTotal: Number(counts[1]),
        tests: Number(counts[3]),
        path: looksLikePath(target) ? cleanPath(target) : '',
      }
    }

    /** Строка сводки карты: «карта покрытия: слои — api, domain; строк — 2». */
    function parseMapHeaderLine(line) {
      const match = /^(?:карта покрытия|coverage map)\s*:\s*(?:слои|layers)\s*—\s*(.*?);\s*(?:строк|rows)\s*—\s*(\d+)\s*$/i.exec(line.trim())
      if (match === null) return null
      const layerText = match[1].trim()
      const layers = layerText === '' || /^(нет слоёв|no layers)$/i.test(layerText)
        ? []
        : layerText.split(',').map((layer) => layer.trim()).filter((layer) => layer !== '')
      return { layers }
    }

    /** Таблица `lipi map` (строки через `|`) → модель карты. */
    function parseMapTable(lines) {
      let headerIndex = -1
      for (let index = 0; index + 1 < lines.length; index += 1) {
        const separator = lines[index + 1].trim()
        if (lines[index].includes('|') && separator.includes('-') && /^[-|+:\s]+$/.test(separator)) {
          headerIndex = index
          break
        }
      }
      if (headerIndex === -1) return null
      const cellsOf = (line) => line.split('|').map((cell) => cell.trim())
      const header = cellsOf(lines[headerIndex])
      if (header.length < 4) return null
      const layers = header.slice(3, header.length - 1).filter((layer) => layer !== '')
      const rows = []
      const notes = []
      for (let index = headerIndex + 2; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim() === '') continue
        const cells = cellsOf(line)
        if (!line.includes('|') || cells.length < header.length) {
          notes.push(line.trim())
          continue
        }
        if (cells[0] === '') continue
        const code = {}
        layers.forEach((layer, offset) => { code[layer] = Number(cells[3 + offset]) || 0 })
        rows.push({
          target: cells[0],
          title: cells[1],
          kind: '',
          status: cells[2],
          code,
          codeTotal: Object.values(code).reduce((sum, number) => sum + number, 0),
          tests: Number(cells[cells.length - 1]) || 0,
          path: looksLikePath(cells[0]) ? cleanPath(cells[0]) : '',
        })
      }
      return { kind: 'map', layers, rows, note: notes.join('\n'), incomplete: false }
    }

    /**
     * Разобрать результат `lipi_map`: JSON `{layers, note, rows}`, строки
     * «цель — заголовок [kind, status]: код N, тесты M» или таблицу lipi.
     */
    function parseMapContent(text, isError, t) {
      const body = textField(text)
      const parsed = parseJsonValue(body)
      if (isRecord(parsed)) {
        const error = errorModelOf(parsed, t)
        if (error !== null) return error
        const nested = typeof parsed.text === 'string' ? parsed.text.trim() : ''
        if (nested !== '' && !Array.isArray(parsed.rows)) return parseMapContent(nested, false, t)
        const model = normalizeMapValue(parsed)
        if (model !== null) return model
        return null
      }
      const lines = body.split(/\r?\n/)
      const table = parseMapTable(lines)
      if (table !== null) return table
      const layers = []
      const rows = []
      const notes = []
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (line === '') continue
        const header = parseMapHeaderLine(line)
        if (header !== null) {
          for (const layer of header.layers) if (!layers.includes(layer)) layers.push(layer)
          continue
        }
        const row = parseMapRowLine(line)
        if (row !== null) {
          rows.push(row)
          for (const layer of Object.keys(row.code)) if (!layers.includes(layer)) layers.push(layer)
        } else {
          notes.push(line)
        }
      }
      if (rows.length > 0 || layers.length > 0) {
        return { kind: 'map', layers, rows, note: notes.join('\n'), incomplete: false }
      }
      return isError ? plainErrorModel(body, t) : null
    }

    /** Бейдж статуса последней проверки: цветная точка и счётчики. */
    function badgeOf(s, t) {
      const e = s.summary?.errors ?? 0
      const w = s.summary?.warnings ?? 0
      const tone = e > 0 ? 'errors' : w > 0 ? 'warnings' : 'clean'
      const text = e > 0
        ? countText(t, e, 'error') + (w > 0 ? ` · ${countText(t, w, 'warning')}` : '')
        : w > 0 ? countText(t, w, 'warning') : t.dock.badgeClean
      return h('span', { className: 'dsh-lipi-badge' },
        h('span', { className: 'dsh-lipi-badge-dot', style: { backgroundColor: TONES[tone] } }),
        text)
    }

    /** Текст ошибки команды: сообщение хоста или строка словаря по коду. */
    function errorTextOf(state, t) {
      if (typeof state.error === 'string' && state.error !== '') return state.error
      const text = typeof state.code === 'string' ? t.errors[state.code] : undefined
      return typeof text === 'string' ? text : t.errors.commandFailed
    }

    function summaryOf(state, t) {
      if (state.kind === 'loading') return t.dock.checking
      if (state.kind === 'error') return errorTextOf(state, t)
      if (state.kind !== 'done') return t.dock.notChecked
      if (state.minLipiHint) return state.minLipiHint
      return t.dock.counts(state.summary?.errors ?? 0, state.summary?.warnings ?? 0)
    }

    /**
     * Whether a command error means the folder has no lipi project: the host
     * text starts with «проект не развёрнут», the lipi output with its English
     * counterpart.
     */
    function isNotDeployed(error) {
      if (typeof error !== 'string') return false
      const text = error.trim().toLowerCase()
      return text.startsWith('проект не развёрнут')
        || text.includes('not deployed')
        || text.includes('not initialized')
        || text.includes('no lipi.json')
    }

    /**
     * Quote one argument for a host command line. Values without spaces or
     * quotes are passed as-is, so even a plain whitespace split keeps working;
     * a value with spaces or quotes is wrapped in double quotes with `\` and
     * `"` escaped, for parsers that respect quoting.
     */
    function quoteArg(value) {
      const text = String(value)
      if (!/[\s"]/.test(text)) return text
      return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
    }

    /** Non-zero parts of a slice summary, e.g. «2 правила · 5 понятий». */
    function summaryLine(summary, t) {
      if (summary === null || typeof summary !== 'object') return ''
      const parts = []
      for (const [key, plural] of SUMMARY_PARTS) {
        const number = summary[key]
        if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) continue
        let part = countText(t, number, plural)
        if (key === 'code' && typeof summary.layers === 'number' && summary.layers > 0) {
          part += ` (${countText(t, summary.layers, 'layer')})`
        }
        parts.push(part)
      }
      return parts.join(' · ')
    }

    /** The first line of a slice: target, title and the target's attributes. */
    function sliceTargetLine(target, t) {
      const data = target !== null && typeof target === 'object' ? target : {}
      const name = typeof data.target === 'string' && data.target !== '' ? data.target : t.sliceResult.targetFallback
      const title = typeof data.title === 'string' && data.title !== '' ? data.title : ''
      const attrs = []
      if (typeof data.kind === 'string' && data.kind !== '') attrs.push(data.kind)
      if (typeof data.found === 'string' && data.found !== '') {
        attrs.push(data.found === 'exact' ? t.sliceResult.foundExact : `${t.sliceResult.foundPrefix}${data.found}`)
      }
      if (typeof data.status === 'string' && data.status !== '') attrs.push(data.status)
      if (typeof data.layer === 'string' && data.layer !== '') attrs.push(`${t.sliceResult.layerPrefix}${data.layer}`)
      const line = title === '' ? name : `${name} — ${title}`
      return attrs.length > 0 ? `${line} [${attrs.join(', ')}]` : line
    }

    /** Render a scalar item field for the fallback item line. */
    function scalarText(value) {
      if (value === null || value === undefined) return ''
      if (typeof value === 'object') return JSON.stringify(value)
      return String(value)
    }

    /** One line of a slice block item, tolerant to fields this version does not know. */
    function sliceItemText(kind, item, t) {
      const data = item !== null && typeof item === 'object' ? item : {}
      if (kind === 'signals') {
        const message = typeof data.message === 'string' ? data.message : ''
        if (typeof data.code !== 'string' || data.code === '') return message
        const place = typeof data.path === 'string' && data.path !== ''
          ? data.path + (Number.isInteger(data.line) && data.line > 0 ? `:${data.line}` : '') + ' — '
          : ''
        return `! ${data.code}  ${place}${message}`
      }
      if (kind === 'entry' || kind === 'code' || kind === 'tests') {
        const path = typeof data.path === 'string' ? data.path : ''
        const line = Number.isInteger(data.line) && data.line > 0 ? `:${data.line}` : ''
        const symbol = typeof data.symbol === 'string' ? data.symbol : ''
        let text = `${path}${line}${symbol === '' ? '' : '  ' + symbol}`
        if (kind !== 'tests' && typeof data.layer === 'string' && data.layer !== '') text += `  [${data.layer}]`
        return text.trim()
      }
      if (typeof data.target === 'string' && data.target !== '') {
        let text = data.target
        if (typeof data.status === 'string' && data.status !== '') text += ' ' + data.status
        if (typeof data.title === 'string' && data.title !== '') text += ` — ${data.title}`
        if (typeof data.relation === 'string' && data.relation !== '') text += ` (${data.relation})`
        if (Number.isInteger(data.code_count) && data.code_count >= 0) {
          text += ` (${countText(t, data.code_count, 'code')})`
        }
        return text
      }
      if (typeof data.text === 'string') return data.text
      if (typeof data.message === 'string') return data.message
      return Object.entries(data).map(([key, value]) => `${key}=${scalarText(value)}`).join('  ')
    }

    /** One slice block: heading, items (or an excerpt) and the omission hint. */
    function renderSliceBlock(block, index, t) {
      const items = Array.isArray(block.items) ? block.items : []
      const omitted = Number.isInteger(block.omitted) && block.omitted > 0 ? block.omitted : 0
      const hints = Array.isArray(block.hint)
        ? block.hint.filter((hint) => typeof hint === 'string' && hint !== '')
        : []
      if (items.length === 0 && omitted === 0) return null
      const title = t.blocks[block.kind]
        ?? (typeof block.kind === 'string' && block.kind !== '' ? block.kind : t.sliceResult.blockFallback)
      const children = [h('div', { key: 'title', className: 'dsh-lipi-block-title' }, title)]
      if (block.kind === 'excerpt') {
        const text = items
          .map((item) => item !== null && typeof item === 'object' && typeof item.text === 'string' ? item.text : '')
          .filter((line) => line !== '')
          .join('\n')
        if (text !== '') children.push(h('pre', { key: 'excerpt', className: 'dsh-lipi-pre' }, text))
      } else {
        items.forEach((item, itemIndex) => {
          if (item === null || typeof item !== 'object') return
          const text = sliceItemText(block.kind, item, t)
          if (text !== '') children.push(h('div', { key: `item-${itemIndex}`, className: 'dsh-lipi-slice-item' }, text))
        })
      }
      if (omitted > 0) {
        const hint = hints.length > 0 ? t.sliceResult.omittedMore(hints.join(', ')) : ''
        children.push(h('div', { key: 'omitted', className: 'dsh-lipi-hint' }, t.sliceResult.omitted(omitted) + hint))
      }
      return h('section', { key: `block-${index}`, className: 'dsh-lipi-block' }, children)
    }

    /** Panel body of a slice result: target line, summary, blocks, notes. */
    function renderSliceResult(state, t) {
      const blocks = Array.isArray(state.blocks) ? state.blocks : []
      const notes = Array.isArray(state.notes) ? state.notes : []
      const children = [
        h('div', { key: 'target', className: 'dsh-lipi-target' }, sliceTargetLine(state.target, t)),
      ]
      const summary = summaryLine(state.summary, t)
      if (summary !== '') children.push(h('div', { key: 'summary', className: 'dsh-lipi-summary' }, summary))
      blocks.forEach((block, index) => {
        if (block === null || typeof block !== 'object') return
        const rendered = renderSliceBlock(block, index, t)
        if (rendered !== null) children.push(rendered)
      })
      if (state.incomplete === true) {
        children.push(h('div', { key: 'incomplete', className: 'dsh-lipi-hint' }, t.sliceResult.incomplete))
      }
      notes.forEach((note, index) => {
        if (note === null || typeof note !== 'object' || typeof note.text !== 'string' || note.text === '') return
        children.push(h('div', { key: `note-${index}`, className: 'dsh-lipi-hint' }, note.text))
      })
      return h('section', { key: 'slice', className: 'dsh-lipi-section' }, children)
    }

    /** Panel body of a coverage map: layer totals and one line per target. */
    function renderMapResult(state, t) {
      const map = normalizeMapValue(state) ?? { kind: 'map', layers: [], rows: [], note: '', incomplete: false }
      const children = [
        h('div', { key: 'title', className: 'dsh-lipi-block-title' }, t.map.title),
        h('div', { key: 'summary', className: 'dsh-lipi-summary' }, mapSummaryLine(map, t)),
      ]
      if (map.layers.length > 0) {
        children.push(h('div', { key: 'layers', className: 'dsh-lipi-summary' },
          `${t.map.layers}: ${mapLayerLine(map)}`))
      }
      if (map.rows.length === 0) {
        children.push(h('div', { key: 'empty', className: 'dsh-lipi-hint' }, t.map.empty))
      }
      map.rows.forEach((row, index) => {
        children.push(h('div', { key: `row-${index}`, className: 'dsh-lipi-slice-item' }, mapRowLine(row, t)))
      })
      if (map.note !== '') children.push(h('div', { key: 'note', className: 'dsh-lipi-hint' }, map.note))
      if (map.incomplete) children.push(h('div', { key: 'incomplete', className: 'dsh-lipi-hint' }, t.map.incomplete))
      return h('section', { key: 'map', className: 'dsh-lipi-section' }, children)
    }

    /** Monospace output section for `lipi init` and `lipi doctor`. */
    function renderOutput(title, text) {
      const body = typeof text === 'string' ? text.trim() : ''
      return h('section', { className: 'dsh-lipi-section' },
        h('div', { className: 'dsh-lipi-block-title' }, title),
        h('pre', { className: 'dsh-lipi-pre' }, body),
      )
    }

    /**
     * @param {{sessionId: string, useSessions: Function, run: (line: string) => Promise<object>}} props
     * Standard slot props (`sessionId`, `useSessions`) plus the `run` function from `inject`.
     */
    function LipiDock({ sessionId, useSessions, run }) {
      const cwd = useSessions((s) => s.byId[sessionId]?.cwd)
      const lang = useLang()
      const t = stringsFor(lang.current)
      // Последняя проверка: от неё зависят точка статуса и шапка. Отдельно от
      // `state`, потому что срез, карта, init и doctor показываются в панели,
      // не подменяя состояние проверки.
      const [checkState, setCheckState] = React.useState({ kind: 'idle' })
      const [state, setState] = React.useState({ kind: 'idle' })
      const [open, setOpen] = React.useState(false)
      const [target, setTarget] = React.useState('')
      const [full, setFull] = React.useState(false)
      const [stagedSlice, setStagedSlice] = React.useState(false)
      const [confirmInit, setConfirmInit] = React.useState(false)
      const [confirmUpgrade, setConfirmUpgrade] = React.useState(false)
      const [initText, setInitText] = React.useState('')
      const [langBusy, setLangBusy] = React.useState(false)
      const [langOpen, setLangOpen] = React.useState(false)
      const langRef = React.useRef(null)
      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)
      // Была ли уже проверка: после смены языка её вывод нужно обновить.
      const checkedRef = React.useRef(false)
      const [box, setBox] = React.useState(null)

      React.useEffect(() => { ensureStyles() }, [])

      /** Запросить язык у lipi: при загрузке и при открытии панели. */
      const loadLang = async () => {
        if (!cwd) return
        const result = await run('/lipi-lang')
        if (result !== null && typeof result === 'object' && result.kind === 'lang') applyLangState(result)
      }

      React.useEffect(() => {
        setCheckState({ kind: 'idle' })
        setState({ kind: 'idle' })
        setOpen(false)
        setBox(null)
        setTarget('')
        setFull(false)
        setConfirmInit(false)
        setInitText('')
        checkedRef.current = false
        if (cwd) void loadLang()
      }, [cwd])
      React.useEffect(() => {
        if (!langOpen) return undefined
        const outsideLang = (event) => {
          if (langRef.current && !langRef.current.contains(event.target)) setLangOpen(false)
        }
        document.addEventListener('mousedown', outsideLang)
        return () => document.removeEventListener('mousedown', outsideLang)
      }, [langOpen])
      React.useEffect(() => {
        if (!open) return undefined
        const outside = (event) => {
          if (anchorRef.current && anchorRef.current.contains(event.target)) return
          if (panelRef.current && panelRef.current.contains(event.target)) return
          setOpen(false)
        }
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', outside)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', outside)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const check = async (mode, keepInit = false) => {
        if (!cwd) return
        checkedRef.current = true
        if (!keepInit) setInitText('')
        setState({ kind: 'loading' })
        setCheckState({ kind: 'loading' })
        const result = await run('/lipi-check ' + cwd + (mode.flag ?? ''))
        setState(result)
        setCheckState(result)
      }

      const slice = async () => {
        const goal = target.trim()
        if (!cwd || goal === '' || state.kind === 'loading') return
        setInitText('')
        setState({ kind: 'loading' })
        setState(await run('/lipi-slice ' + quoteArg(cwd) + ' ' + quoteArg(goal)
          + (full ? ' --full' : '') + (stagedSlice ? ' --staged' : '')))
      }

      const upgrade = async () => {
        if (!cwd) return
        setConfirmUpgrade(false)
        setInitText('')
        setState({ kind: 'loading' })
        const result = await run('/lipi-init ' + quoteArg(cwd))
        if (result.kind !== 'init') {
          setState(result)
          return
        }
        setInitText(result.text)
        setState(result)
        await check({ flag: '' }, true)
      }

      const upgradePlan = async () => {
        if (!cwd) return
        setState({ kind: 'loading' })
        const result = await run('/lipi-init ' + quoteArg(cwd) + ' --dry-run')
        setState(result.kind === 'init' ? { ...result, initLabel: t.output.plan } : result)
      }

      const doctor = async () => {
        if (!cwd) return
        setInitText('')
        setState({ kind: 'loading' })
        setState(await run('/lipi-doctor ' + quoteArg(cwd)))
      }

      const showMap = async () => {
        if (!cwd) return
        setInitText('')
        setState({ kind: 'loading' })
        setState(await run('/lipi-map ' + quoteArg(cwd)))
      }

      const deploy = async () => {
        if (!cwd) return
        setConfirmInit(false)
        setInitText('')
        setState({ kind: 'loading' })
        const result = await run('/lipi-init ' + quoteArg(cwd))
        if (result.kind !== 'init') {
          setState(result)
          return
        }
        // Вывод init остаётся в панели, а проверка перезапускается сразу:
        // после успешного развёртывания кнопки проверки возвращаются.
        setInitText(result.text)
        setState(result)
        await check({ flag: '' }, true)
      }

      /**
       * Переключить язык: попросить lipi запомнить код и, если проверка уже
       * была, повторить её в быстром режиме — вывод lipi придёт на новом языке.
       */
      const switchLanguage = async (code) => {
        if (!cwd || code === lang.current || langBusy) return
        setLangBusy(true)
        const result = await run('/lipi-lang ' + code)
        setLangBusy(false)
        if (result !== null && typeof result === 'object' && result.kind === 'lang') applyLangState(result)
        if (checkedRef.current) await check(MODES[0], true)
      }

      const tone = toneOf(checkState)
      const loading = state.kind === 'loading' || langBusy
      const summary = summaryOf(checkState, t)
      const headerValue = checkState.kind === 'loading' ? t.dock.checking
        : checkState.kind === 'done' && checkState.version ? t.dock.version(checkState.version)
          : checkState.kind === 'idle' ? t.dock.notChecked
            : ''
      const statusText = state.kind === 'error' ? errorTextOf(state, t)
        : state.kind === 'done' ? summary
          : ''
      const undeployed = state.kind === 'error' && isNotDeployed(state.error)
      const needsUpgrade = state.kind === 'done'
        && Array.isArray(state.errors) && state.errors.some((item) => item.code === 'V1')
      const availableLanguages = lang.available.length > 0 ? lang.available : [lang.current]
      const langOptions = availableLanguages.includes(lang.current)
        ? availableLanguages
        : [lang.current, ...availableLanguages]

      const findings = state.kind === 'done'
        ? [
            ...(state.errors ?? []).map((e) => ({ level: 'errors', code: e.code, loc: `${e.file}${e.line ? ':' + e.line : ''}`, msg: e.message })),
            ...(state.warnings ?? []).map((w) => ({ level: 'warnings', code: w.code, loc: `${w.file}${w.line ? ':' + w.line : ''}`, msg: w.message })),
          ]
        : []

      if (!cwd) {
        return h('button', {
          type: 'button', className: 'dsh-lipi-pill', disabled: true,
          title: t.dock.noCwd,
        },
          h(Icon, { tone: 'idle', dimmed: true }))
      }

      return h(React.Fragment, null,
        h('button', {
          ref: anchorRef, type: 'button', className: 'dsh-lipi-pill',
          onClick: () => {
            setOpen((was) => {
              const next = !was
              if (next) {
                if (anchorRef.current) setBox(panelBox(anchorRef.current.getBoundingClientRect()))
                void loadLang()
              } else {
                setBox(null)
              }
              return next
            })
          },
          'aria-expanded': open, 'aria-haspopup': 'dialog',
          title: t.dock.toggleTitle(summary),
          'aria-label': t.dock.statusAria,
        },
          h(Icon, { tone, dimmed: false })),
        open && box && ReactDOM.createPortal(h('div', {
          ref: panelRef, className: 'dsh-lipi-panel', role: 'dialog', 'aria-label': t.app,
          style: {
            left: box.left, width: box.width, maxHeight: box.maxHeight,
            ...(box.bottom !== undefined ? { bottom: box.bottom } : { top: box.top }),
          },
        },
          h('div', { className: 'dsh-lipi-title' },
            h('span', null, t.app),
            h('div', { className: 'dsh-lipi-lang', ref: langRef },
              h('button', {
                type: 'button', className: 'dsh-lipi-lang-pill',
                'aria-label': t.lang.aria, 'aria-haspopup': 'menu', 'aria-expanded': langOpen,
                disabled: langBusy, title: t.lang.label,
                onClick: () => setLangOpen(!langOpen),
              }, lang.current, h('span', { 'aria-hidden': true }, '\u25be')),
              langOpen && h('div', { className: 'dsh-lipi-lang-menu', role: 'menu' },
                langOptions.map((code) => h('button', {
                  key: code, type: 'button', role: 'menuitem',
                  className: 'dsh-lipi-lang-option' + (code === lang.current ? ' dsh-lipi-lang-option-current' : ''),
                  onClick: () => { setLangOpen(false); void switchLanguage(code) },
                }, languageLabel(code))))),
          ),
          h('div', { className: 'dsh-lipi-status', role: 'status', 'aria-live': 'polite' },
            checkState.kind === 'done' && badgeOf(checkState, t),
            checkState.kind === 'done' && headerValue && h('span', { className: 'dsh-lipi-title-value' }, headerValue),
            checkState.kind !== 'done' && (statusText || headerValue) && h('span', null, statusText || headerValue),
          ),
          needsUpgrade && h('div', { className: 'dsh-lipi-actions' },
            confirmUpgrade
              ? [
                  h('button', {
                    key: 'upgrade-yes', type: 'button', className: 'dsh-lipi-action',
                    disabled: loading, onClick: upgrade, title: t.actions.updateConfirmTitle,
                  }, t.actions.updateConfirm),
                  h('button', {
                    key: 'upgrade-no', type: 'button', className: 'dsh-lipi-action',
                    disabled: loading, onClick: () => setConfirmUpgrade(false), title: t.actions.cancelUpdateTitle,
                  }, t.actions.cancel),
                ]
              : [
                  h('button', {
                    key: 'upgrade', type: 'button', className: 'dsh-lipi-action',
                    disabled: loading, onClick: () => setConfirmUpgrade(true),
                    title: t.actions.updateTitle,
                  }, t.actions.update),
                  h('button', {
                    key: 'upgrade-plan', type: 'button', className: 'dsh-lipi-action',
                    disabled: loading, onClick: upgradePlan,
                    title: t.actions.updatePlanTitle,
                  }, t.actions.updatePlan),
                ],
          ),
          h('div', { className: 'dsh-lipi-actions' },
            undeployed
              ? (confirmInit
                  ? [
                      h('button', {
                        key: 'init-yes', type: 'button', className: 'dsh-lipi-action',
                        disabled: loading, onClick: deploy, title: t.actions.deployConfirmTitle,
                      }, t.actions.deployConfirm),
                      h('button', {
                        key: 'init-no', type: 'button', className: 'dsh-lipi-action',
                        disabled: loading, onClick: () => setConfirmInit(false), title: t.actions.cancelDeployTitle,
                      }, t.actions.cancel),
                    ]
                  : h('button', {
                      key: 'init', type: 'button', className: 'dsh-lipi-action',
                      disabled: loading, onClick: () => setConfirmInit(true), title: t.actions.deployTitle,
                    }, t.actions.deploy))
              : MODES.map((mode) => h('button', {
                  key: mode.id, type: 'button', className: 'dsh-lipi-action',
                  disabled: loading, onClick: () => check(mode), title: t.modes[mode.id],
                }, t.modes[mode.id])),
          ),
          h('div', { className: 'dsh-lipi-caption' }, t.slice.caption),
          h('div', { className: 'dsh-lipi-slice' },
            h('input', {
              className: 'dsh-lipi-input', type: 'text',
              value: target, placeholder: t.slice.placeholder,
              'aria-label': t.slice.aria,
              onChange: (event) => setTarget(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                slice()
              },
            }),
            h('button', {
              type: 'button', className: 'dsh-lipi-action',
              disabled: loading || target.trim() === '',
              onClick: slice, title: t.slice.runTitle,
            }, t.slice.run),
          ),
          h('div', { className: 'dsh-lipi-actions dsh-lipi-flags' },
            h('label', { className: 'dsh-lipi-check' },
              h('input', {
                type: 'checkbox', checked: full, disabled: loading,
                onChange: (event) => setFull(event.target.checked),
              }),
              t.slice.full),
            h('label', { className: 'dsh-lipi-check' },
              h('input', {
                type: 'checkbox', checked: stagedSlice, disabled: loading,
                onChange: (event) => setStagedSlice(event.target.checked),
              }),
              t.slice.staged),
            h('button', {
              type: 'button', className: 'dsh-lipi-action',
              disabled: loading, onClick: doctor, title: t.slice.doctorTitle,
            }, t.slice.doctor),
            h('button', {
              type: 'button', className: 'dsh-lipi-action',
              disabled: loading, onClick: showMap, title: t.map.runTitle,
            }, t.map.button),
          ),
          findings.length > 0 && h('ul', { className: 'dsh-lipi-list' },
            findings.map((f) => h('li', { key: f.code + f.loc + f.msg, className: 'dsh-lipi-finding' },
              h('span', { className: 'dsh-lipi-chip', style: { color: TONES[f.level] } }, f.code),
              f.loc !== '' && h('span', { className: 'dsh-lipi-finding-loc' }, f.loc),
              h('span', { className: 'dsh-lipi-finding-msg' }, f.msg))),
            state.truncated && h('li', { className: 'dsh-lipi-item' }, t.dock.more(state.truncatedCount ?? 0)),
          ),
          state.kind === 'done' && state.baseline && h('div', { className: 'dsh-lipi-hint' },
            t.dock.baseline(state.baseline.known ?? 0, state.baseline.fixed ?? 0)),
          state.kind === 'slice' && renderSliceResult(state, t),
          state.kind === 'map' && renderMapResult(state, t),
          state.kind === 'doctor' && renderOutput(t.output.diagnostics, state.text),
          state.kind === 'init' && renderOutput(state.initLabel ?? t.output.deploy, state.text),
          state.kind !== 'init' && initText !== '' && renderOutput(t.output.deploy, initText),
        ), document.body),
      )
    }

    /** Inline SVG mark: rounded square with «v» and a status dot beside it. */
    function Icon({ tone, dimmed }) {
      return h(React.Fragment, null,
        h('svg', { viewBox: '0 0 18 18', 'aria-hidden': true },
          h('rect', { x: 1, y: 1, width: 16, height: 16, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 1 }),
          h('path', { d: 'M5 6.5 L8.2 11 L13 5.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        ),
        h('span', { className: 'dsh-lipi-dot', style: { backgroundColor: TONES[tone], opacity: dimmed ? 0.5 : 1 } }),
      )
    }

    // --- Карточки результатов инструментов в чате -------------------------
    // Слот `tool.call.toolview` — keyed: ключ равен имени инструмента по
    // проводу, занятый ключ заменяет стандартную строку результата. Карточки
    // только представляют результат и не меняют вывод инструментов: content
    // разбирается терпимо, а нераспознанный текст показывается компактной
    // строкой как есть (keyed-слот при занятом ключе не возвращает
    // стандартную строку, поэтому `null` оставил бы в чате пустое место).

    /** whether a value is a plain object (not null, not an array). */
    function isRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    /** Строковое поле или пустая строка. */
    function textField(value) {
      return typeof value === 'string' ? value : ''
    }

    /** Неотрицательное целое поле или null. */
    function countField(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
    }

    /** Положительный номер строки или 0. */
    function positiveLine(value) {
      return Number.isInteger(value) && value > 0 ? value : 0
    }

    /** Разобрать JSON, если content — объект или массив; иначе null. */
    function parseJsonValue(text) {
      const trimmed = typeof text === 'string' ? text.trim() : ''
      if (trimmed === '' || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null
      try {
        const parsed = JSON.parse(trimmed)
        return isRecord(parsed) || Array.isArray(parsed) ? parsed : null
      } catch {
        return null
      }
    }

    /**
     * Текст результата инструмента: `content` — массив блоков DSH (`text`
     * или структурные блоки), но терпим и к готовой строке.
     */
    function contentTextOf(block) {
      const content = isRecord(block) ? block.content : undefined
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      const parts = []
      for (const item of content) {
        if (typeof item === 'string') parts.push(item)
        else if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
        else if (item !== null && typeof item === 'object') {
          try {
            parts.push(JSON.stringify(item, null, 2))
          } catch {
            // неразбираемый блок не должен ломать карточку
          }
        }
      }
      return parts.join('\n')
    }

    /** Модель ошибки инструмента: tool-level error, parseError или голая ошибка. */
    function errorModelOf(value, t) {
      if (!isRecord(value)) return null
      if (typeof value.error === 'string' && value.error.trim() !== '') {
        return {
          kind: 'error',
          error: value.error.trim(),
          hint: textField(value.hint),
          details: textField(value.details),
          exitCode: countField(value.exitCode),
        }
      }
      if (value.parseError === true) {
        const details = [textField(value.stdout), textField(value.stderr)].filter((part) => part !== '').join('\n')
        return {
          kind: 'error',
          error: t.cards.notJson,
          hint: t.cards.notJsonHint,
          details,
          exitCode: countField(value.exitCode),
        }
      }
      return null
    }

    /** Модель ошибки из простого текста (когда инструмент завершился ошибкой). */
    function plainErrorModel(text, t) {
      const trimmed = typeof text === 'string' ? text.trim() : ''
      return { kind: 'error', error: trimmed !== '' ? trimmed : t.cards.toolFailed, hint: '', details: '', exitCode: null }
    }

    /** Присоединить относительный путь к корню проекта, если он известен. */
    function withRoot(root, path) {
      if (typeof path !== 'string' || path === '') return ''
      if (typeof root !== 'string' || root === '' || /^([/\\]|[A-Za-z]:[\\/])/.test(path)) return path
      const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
      return root.replace(/[\\/]+$/, '') + separator + path
    }

    /** Похоже ли значение на путь проекта (а не на номер работы или статус). */
    function looksLikePath(value) {
      if (typeof value !== 'string' || value === '' || /\s/.test(value)) return false
      const base = value.split('#')[0]
      if (base === '') return false
      if (base.includes('/') || base.includes('\\')) return true
      return /\.(md|markdown|py|js|mjs|cjs|ts|tsx|jsx|json|ya?ml|toml|txt|css|html|sh)$/i.test(base)
    }

    /** Путь для openFile: без якоря и хвостовой пунктуации. */
    function cleanPath(value) {
      return textField(value).split('#')[0].replace(/[.,;:]+$/, '')
    }

    /** Одна находка check из JSON-объекта. */
    function findingOf(item, severity) {
      const data = isRecord(item) ? item : {}
      const file = textField(data.file) || textField(data.path)
      return {
        severity,
        code: textField(data.code),
        file,
        line: positiveLine(data.line),
        message: textField(data.message),
      }
    }

    /** Уровень находки по подписи в тексте: русской или английской. */
    function severityOf(label) {
      const text = String(label).trim().toLowerCase()
      return text === 'ошибка' || text === 'error' ? 'error' : 'warning'
    }

    /** Находка check из строки текстового формата `lipi check` (ru или en). */
    function checkFindingLine(rawLine) {
      const line = rawLine.trim()
      if (line === '') return null
      const level = '(ошибка|предупреждение|error|warning)'
      let match = new RegExp(`^\\[${level}\\s+([^\\]]+)\\]\\s+(.+)$`, 'i').exec(line)
      if (match !== null) {
        const severity = severityOf(match[1])
        const rest = match[3].trim()
        const place = /^(.+?)(?::(\d+))?\s+—\s+([\s\S]*)$/.exec(rest)
        if (place !== null) {
          return { severity, code: match[2].trim(), file: place[1].trim(), line: positiveLine(Number(place[2])), message: place[3].trim() }
        }
        return { severity, code: match[2].trim(), file: '', line: 0, message: rest }
      }
      match = new RegExp(`^(.+?)(?::(\\d+))?\\s+—\\s+\\[${level}\\s+([^\\]]+)\\]\\s*([\\s\\S]*)$`, 'i').exec(line)
      if (match !== null) {
        const severity = severityOf(match[3])
        return { severity, code: match[4].trim(), file: match[1].trim(), line: positiveLine(Number(match[2])), message: match[5].trim() }
      }
      match = new RegExp(`^(.+?):\\s+\\[${level}\\s+([^\\]]+)\\]\\s*([\\s\\S]*)$`, 'i').exec(line)
      if (match !== null) {
        const severity = severityOf(match[2])
        return { severity, code: match[3].trim(), file: match[1].trim(), line: 0, message: match[4].trim() }
      }
      return null
    }

    /**
     * Разобрать результат `lipi_check`: сначала JSON (нынешний вывод хост-
     * рендера), затем текстовый формат `lipi check` (сводка, находки,
     * базовая линия) на русском или английском. Ничего не распознали — null.
     */
    function parseCheckContent(text, isError, t) {
      const body = textField(text)
      const parsed = parseJsonValue(body)
      if (isRecord(parsed)) {
        const error = errorModelOf(parsed, t)
        if (error !== null) return error
        const summary = isRecord(parsed.summary) ? parsed.summary : null
        const errors = (Array.isArray(parsed.errors) ? parsed.errors : []).filter(isRecord).map((item) => findingOf(item, 'error'))
        const warnings = (Array.isArray(parsed.warnings) ? parsed.warnings : []).filter(isRecord).map((item) => findingOf(item, 'warning'))
        const baseline = isRecord(parsed.baseline)
          ? { known: countField(parsed.baseline.known) ?? 0, fixed: countField(parsed.baseline.fixed) ?? 0 }
          : null
        const recognized = summary !== null
          || Array.isArray(parsed.errors)
          || Array.isArray(parsed.warnings)
          || baseline !== null
          || typeof parsed.version === 'string'
          || typeof parsed.root === 'string'
        if (!recognized) return null
        return {
          kind: 'check',
          findings: [...errors, ...warnings],
          counts: {
            errors: countField(summary?.errors) ?? errors.length,
            warnings: countField(summary?.warnings) ?? warnings.length,
            pages: countField(summary?.pages),
            docs: countField(summary?.docs),
            tags: countField(summary?.tags),
          },
          baseline,
          version: textField(parsed.version) || null,
          root: textField(parsed.root) || null,
          minLipiHint: textField(parsed.minLipiHint) || textField(parsed.minVersionHint) || null,
          truncated: parsed.truncated === true,
          truncatedCount: countField(parsed.truncatedCount) ?? 0,
        }
      }
      const counts = {}
      for (const [key, pattern] of [
        ['pages', /(?:страниц(?:ы)?\s+описания|description\s+pages):\s*(\d+)/i],
        ['docs', /(?:рабочих\s+документов|work\s+documents):\s*(\d+)/i],
        ['tags', /(?:меток|tags):\s*(\d+)/i],
        ['errors', /(?:ошибок|errors):\s*(\d+)/i],
        ['warnings', /(?:предупреждений|warnings):\s*(\d+)/i],
      ]) {
        const match = pattern.exec(body)
        if (match !== null) counts[key] = Number(match[1])
      }
      const findings = []
      for (const line of body.split(/\r?\n/)) {
        const finding = checkFindingLine(line)
        if (finding !== null) findings.push(finding)
      }
      const baselineMatch = /(?:в\s+базовой\s+линии\s+(\d+),\s*исправлено\s+(\d+)|baseline\s+(\d+),\s*fixed\s+(\d+))/i.exec(body)
      const baseline = baselineMatch === null
        ? null
        : {
            known: Number(baselineMatch[1] ?? baselineMatch[3]),
            fixed: Number(baselineMatch[2] ?? baselineMatch[4]),
          }
      const recognized = findings.length > 0 || Object.keys(counts).length > 0 || baseline !== null
      if (!recognized) return isError ? plainErrorModel(body, t) : null
      const errorCount = counts.errors ?? findings.filter((finding) => finding.severity === 'error').length
      const warningCount = counts.warnings ?? findings.filter((finding) => finding.severity === 'warning').length
      const expected = errorCount + warningCount
      return {
        kind: 'check',
        findings,
        counts: { errors: errorCount, warnings: warningCount, pages: counts.pages ?? null, docs: counts.docs ?? null, tags: counts.tags ?? null },
        baseline,
        version: null,
        root: null,
        minLipiHint: null,
        truncated: findings.length < expected,
        truncatedCount: Math.max(0, expected - findings.length),
      }
    }

    /** Разобрать строку цели среза: «цель — заголовок [kind, found…]». */
    function parseSliceTarget(line) {
      const raw = line.trim()
      const bracket = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(raw)
      const main = bracket === null ? raw : bracket[1].trim()
      const attrs = bracket === null ? [] : bracket[2].split(',').map((part) => part.trim()).filter((part) => part !== '')
      const dash = /^(.+?)\s+—\s+(.+)$/.exec(main)
      const name = dash === null ? main : dash[1].trim()
      const title = dash === null ? '' : dash[2].trim()
      return { raw, name, title, attrs, path: looksLikePath(name) ? cleanPath(name) : '' }
    }

    /** Элемент блока «Сигналы»: `! T3  path:line — message` или `· message`. */
    function parseSignalItem(line) {
      const match = /^!\s+(\S+)\s{2,}([\s\S]*)$/.exec(line)
      if (match === null) return { kind: 'text', text: line }
      const code = match[1]
      const rest = match[2].trim()
      const dashIndex = rest.indexOf(' — ')
      if (dashIndex === -1) return { kind: 'signal', code, path: '', line: 0, message: rest }
      const place = rest.slice(0, dashIndex).trim()
      const message = rest.slice(dashIndex + 3).trim()
      const placeMatch = /^(.+?)(?::(\d+))?$/.exec(place)
      if (placeMatch !== null && looksLikePath(placeMatch[1])) {
        return { kind: 'signal', code, path: cleanPath(placeMatch[1]), line: positiveLine(Number(placeMatch[2])), message }
      }
      return { kind: 'signal', code, path: '', line: 0, message: rest }
    }

    /** Элемент места в коде: `path:line  symbol  [layer]`, тесты — без слоя. */
    function parsePlaceItem(line) {
      const match = /^(\S+?)(?::(\d+))?(?:\s+([\s\S]*))?$/.exec(line)
      if (match === null || !looksLikePath(match[1])) return { kind: 'text', text: line }
      return {
        kind: 'place',
        path: cleanPath(match[1]),
        line: positiveLine(Number(match[2])),
        detail: (match[3] ?? '').trim(),
      }
    }

    /** Элемент документа: `target — title`, target может быть путём. */
    function parseDocumentItem(line) {
      const dashIndex = line.indexOf(' — ')
      const target = (dashIndex === -1 ? line : line.slice(0, dashIndex)).trim()
      const rest = dashIndex === -1 ? '' : line.slice(dashIndex + 3).trim()
      const firstWord = target.split(/\s+/)[0] ?? ''
      return {
        kind: 'doc',
        text: line,
        target,
        rest,
        path: looksLikePath(firstWord) ? cleanPath(firstWord) : '',
      }
    }

    /** Одна строка среза по виду блока. */
    function classifySliceItem(kind, line) {
      if (kind === 'signals') return parseSignalItem(line)
      if (kind === 'entry' || kind === 'code' || kind === 'tests') return parsePlaceItem(line)
      if (kind === 'obey' || kind === 'concepts' || kind === 'targets' || kind === 'context') return parseDocumentItem(line)
      return { kind: 'text', text: line }
    }

    /** Строка сводки среза: «сводка: …» или набор «N ошибок · M …» (ru/en). */
    function isSliceSummaryLine(line) {
      if (/^(сводка|summary):/i.test(line)) return true
      const tokens = line.split(' · ').map((part) => part.trim()).filter((part) => part !== '')
      if (tokens.length === 0) return false
      if (!tokens.every((part) => /^\d+\s+\S+/.test(part))) return false
      return /(ошибк|предупрежд|решени|правил|поняти|точк|мест|тест|работ|цел|error|warning|decision|rule|concept|entry|place|test|work|target|layer)/i.test(line)
    }

    /** Строка «скрыто/показано/обрезано» внутри блока среза (ru/en). */
    const SLICE_OMITTED = /^(показано\s+\d+\s+из\s+\d+|обрезано\b|реализует ещё\b|скрыто\s+\d+|ещё\s+\d+|shown\s+\d+\s+of\s+\d+|truncated\b|omitted\s+\d+|more\s+\d+)/i

    /**
     * Разобрать текст `lipi_slice`: строка цели, сводка, примечания, блоки с
     * заголовками и отступными элементами, признак неполноты. Ошибки —
     * tool-level JSON. Ничего не распознали — null.
     */
    function parseSliceContent(text, isError, t) {
      const body = textField(text)
      const parsed = parseJsonValue(body)
      if (isRecord(parsed)) {
        const error = errorModelOf(parsed, t)
        if (error !== null) return error
        if (typeof parsed.text === 'string' && parsed.text.trim() !== '') return parseSliceContent(parsed.text, false, t)
        return null
      }
      const lines = body.split(/\r?\n/)
      const targetIndex = lines.findIndex((line) => line.trim() !== '')
      if (targetIndex === -1) return isError ? plainErrorModel(body, t) : null
      const target = parseSliceTarget(lines[targetIndex])
      const summaryParts = []
      const notes = []
      const blocks = []
      let current = null
      let incomplete = false
      const finish = () => {
        if (current === null) return
        blocks.push(current)
        current = null
      }
      for (let index = targetIndex + 1; index < lines.length; index += 1) {
        const raw = lines[index]
        const line = raw.trim()
        if (line === '') {
          finish()
          continue
        }
        if (/^\s/.test(raw)) {
          if (current === null) {
            notes.push(line)
            continue
          }
          if (SLICE_OMITTED.test(line)) current.omitted.push(line)
          else current.items.push(classifySliceItem(current.kind, line))
          continue
        }
        const kind = BLOCK_KINDS_BY_TITLE[line]
        const nextIndented = index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])
        if (kind !== undefined || nextIndented) {
          finish()
          current = { title: line, kind: kind ?? '', items: [], omitted: [] }
          continue
        }
        if (/^(неполно|incomplete)\b/i.test(line)) {
          incomplete = true
          finish()
          continue
        }
        finish()
        const summaryMatch = /^(?:сводка|summary):\s*(.*)$/i.exec(line)
        if (summaryMatch !== null) {
          summaryParts.push(summaryMatch[1].trim())
        } else if (isSliceSummaryLine(line)) {
          summaryParts.push(line)
        } else {
          notes.push(line)
        }
      }
      finish()
      const keptBlocks = blocks.filter((block) => block.items.length > 0 || block.omitted.length > 0)
      const summary = summaryParts.filter((part) => part !== '').join(' · ')
      const recognized = target.attrs.length > 0 || keptBlocks.length > 0 || summary !== ''
      if (!recognized) return isError ? plainErrorModel(body, t) : null
      return { kind: 'slice', target, summary, notes, blocks: keptBlocks, incomplete }
    }

    /** Разобрать результат `lipi_new`: JSON `{path,id,index_updated}` или строки «создан:/занят:». */
    function parseNewContent(text, isError, t) {
      const body = textField(text)
      const parsed = parseJsonValue(body)
      if (isRecord(parsed)) {
        const error = errorModelOf(parsed, t)
        if (error !== null) return error
        if (typeof parsed.path === 'string' && parsed.path.trim() !== '') {
          return {
            kind: 'new',
            path: parsed.path.trim(),
            id: textField(parsed.id),
            indexUpdated: parsed.index_updated === true,
            lines: [],
          }
        }
        if (typeof parsed.text === 'string') return parseNewContent(parsed.text, false, t)
        return null
      }
      const createdMatch = /^(?:создан|created):\s*(.+)$/m.exec(body)
      const hasOther = /^(занят|путь|номер|указатель|busy|path|number|index):/im.test(body)
      if (createdMatch === null && !hasOther) return isError ? plainErrorModel(body, t) : null
      let path = createdMatch === null ? '' : createdMatch[1].trim()
      let id = ''
      let indexUpdated = false
      const idMatch = /\(([A-Z]+-\d+)\)/.exec(path)
      if (idMatch !== null) {
        id = idMatch[1]
        indexUpdated = /(?:указатель\s+обновлён|index\s+updated)/i.test(path)
        path = path.slice(0, idMatch.index).trim()
      }
      const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !/^(создан|created):/.test(line))
      return { kind: 'new', path, id, indexUpdated, lines }
    }

    /** Пустое ли значение для обрезки пустых секций графа. */
    function isBlankValue(value) {
      if (value === null || value === undefined) return true
      if (Array.isArray(value)) return value.length === 0
      if (isRecord(value)) {
        const keys = Object.keys(value)
        return keys.length === 0 || keys.every((key) => isBlankValue(value[key]))
      }
      return false
    }

    /** Рекурсивно убрать пустые объекты и массивы из текста графа. */
    function pruneEmptyValue(value) {
      if (Array.isArray(value)) return value.map(pruneEmptyValue).filter((item) => !isBlankValue(item))
      if (isRecord(value)) {
        const result = {}
        for (const [key, child] of Object.entries(value)) {
          const pruned = pruneEmptyValue(child)
          if (!isBlankValue(pruned)) result[key] = pruned
        }
        return result
      }
      return value
    }

    /**
     * Разобрать результат `lipi_graph`: JSON графа (нынешний вывод) или
     * текстовый граф. Пустые секции обрезаются, текст показывается моноширинно.
     */
    function parseGraphContent(text, isError, t) {
      const body = textField(text)
      const parsed = parseJsonValue(body)
      if (isRecord(parsed)) {
        const error = errorModelOf(parsed, t)
        if (error !== null) return error
        if (isRecord(parsed.structure)) {
          const structure = parsed.structure
          const nodes = Array.isArray(structure.nodes) ? structure.nodes : []
          const edges = Array.isArray(structure.edges) ? structure.edges : []
          const counts = isRecord(structure.counts) ? structure.counts : isRecord(structure.resultCounts) ? structure.resultCounts : {}
          const nodeCount = countField(counts.nodes) ?? nodes.length
          const edgeCount = countField(counts.edges) ?? edges.length
          const summaryParts = [t.cards.graphNodes(nodeCount), t.cards.graphEdges(edgeCount)]
          if (typeof structure.focus === 'string' && structure.focus !== '') summaryParts.push(t.cards.graphFocus(structure.focus))
          if (structure.found === false) summaryParts.push(t.cards.graphNotFound)
          if (structure.orphans === true) summaryParts.push(t.cards.graphOrphans)
          if (structure.uncovered === true) summaryParts.push(t.cards.graphUncovered)
          if (Array.isArray(structure.stale) && structure.stale.length > 0) summaryParts.push(t.cards.graphStale(structure.stale.length))
          if (countField(parsed.truncatedCount) !== null && parsed.truncatedCount > 0) summaryParts.push(t.cards.graphHidden(parsed.truncatedCount))
          const shown = {}
          for (const key of ['root', 'version', 'exitCode', 'truncated', 'truncatedCount']) {
            if (!isBlankValue(parsed[key])) shown[key] = parsed[key]
          }
          const shownStructure = {}
          for (const key of ['counts', 'resultCounts', 'focus', 'found', 'suggestions', 'incoming', 'outgoing', 'orphans', 'uncovered', 'stale']) {
            if (!isBlankValue(structure[key])) shownStructure[key] = structure[key]
          }
          if (nodes.length > 0) shownStructure.nodes = nodes
          if (edges.length > 0) shownStructure.edges = edges
          if (!isBlankValue(shownStructure)) shown.structure = shownStructure
          const pruned = pruneEmptyValue(shown)
          return {
            kind: 'graph',
            summary: summaryParts.join(' · '),
            text: isBlankValue(pruned) ? '' : JSON.stringify(pruned, null, 2),
          }
        }
        if (typeof parsed.diagram === 'string' && parsed.diagram.trim() !== '') {
          return { kind: 'graph', summary: t.cards.graphFormat(textField(parsed.format) || t.cards.graphDiagram), text: parsed.diagram.trim() }
        }
        if (Array.isArray(parsed.stale)) {
          const stale = parsed.stale
          return {
            kind: 'graph',
            summary: stale.length > 0 ? t.cards.graphStale(stale.length) : t.cards.graphNoStale,
            text: stale.length > 0 ? JSON.stringify(pruneEmptyValue(stale), null, 2) : '',
          }
        }
        return null
      }
      const trimmed = body.trim()
      if (trimmed === '') return isError ? plainErrorModel(body, t) : null
      if (isError) return plainErrorModel(body, t)
      const recognized = /(узел|узлы|узлов|ребр|рёбер|edges?|nodes?|сводк|граф|summary|graph)/i.test(trimmed)
      if (!recognized) return null
      const lines = trimmed.split(/\r?\n/).map((line) => line.replace(/\s+$/, '')).filter((line) => line !== '')
      const summaryLine = lines.find((line) => /^(узлов|рёбер|сводка|всего|nodes|edges|summary|total)/i.test(line.trim()))
      return {
        kind: 'graph',
        summary: summaryLine !== undefined ? summaryLine.trim() : t.cards.graphLines(lines.length),
        text: lines.join('\n'),
      }
    }

    /** Значок lipi для шапки карточки. */
    function LipiMark() {
      return h('svg', { viewBox: '0 0 18 18', 'aria-hidden': true },
        h('rect', { x: 1, y: 1, width: 16, height: 16, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 1 }),
        h('path', { d: 'M5 6.5 L8.2 11 L13 5.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Шеврон кнопки сворачивания. */
    function LipiChevron() {
      return h('svg', { viewBox: '0 0 18 18', 'aria-hidden': true },
        h('path', { d: 'M4 6.5 L9 11.5 L14 6.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Кликабельный путь: openFile(path, {line}) для строки из текста. */
    function pathButton(label, path, line, openFile, key) {
      const canOpen = typeof openFile === 'function' && typeof path === 'string' && path !== ''
      if (!canOpen) return h('span', { key, className: 'dsh-lipi-card-code' }, label)
      const options = Number.isInteger(line) && line > 0 ? { line } : undefined
      return h('button', {
        key,
        type: 'button',
        className: 'dsh-lipi-card-path',
        title: path,
        onClick: (event) => {
          if (event !== null && typeof event === 'object' && typeof event.stopPropagation === 'function') event.stopPropagation()
          openFile(path, options)
        },
      }, label)
    }

    /** Заголовок инструмента из словаря: `lipi_check` → «Проверка lipi». */
    function toolTitle(t, toolName) {
      return t.cards.titles[toolName] ?? toolName
    }

    /**
     * Каркас карточки: шапка (значок, название, бейдж, подпись), кнопка
     * сворачивания и тело. Живёт в потоке чата: фон прозрачный, без
     * позиционирования поверх страницы.
     */
    function LipiCardFrame({ toolName, title, badge, subtitle, body, disclosure, t }) {
      const expandable = body !== null && body !== undefined
      const expanded = expandable && isRecord(disclosure) && disclosure.expanded === true
      const toggle = () => {
        if (isRecord(disclosure) && typeof disclosure.toggle === 'function') disclosure.toggle()
      }
      const children = [
        h('div', { key: 'head', className: 'dsh-lipi-card-head' },
          h('span', {
            key: 'mark',
            className: 'dsh-lipi-card-mark',
            style: isRecord(badge) ? { color: TONES[badge.tone] } : undefined,
          }, LipiMark()),
          h('span', { key: 'main', className: 'dsh-lipi-card-head-main' },
            h('span', { key: 'line', className: 'dsh-lipi-card-head-line' },
              h('span', { key: 'title', className: 'dsh-lipi-card-title' }, title),
              isRecord(badge) && h('span', {
                key: 'badge',
                className: 'dsh-lipi-badge',
                style: { color: TONES[badge.tone] ?? TONES.idle },
              },
                h('span', { key: 'dot', className: 'dsh-lipi-badge-dot' }),
                h('span', { key: 'text', className: 'dsh-lipi-badge-text' }, badge.text),
              ),
            ),
            typeof subtitle === 'string' && subtitle !== ''
              ? h('span', { key: 'sub', className: 'dsh-lipi-card-sub', title: subtitle }, subtitle)
              : null,
          ),
          expandable
            ? h('button', {
              key: 'toggle',
              type: 'button',
              className: 'dsh-lipi-card-toggle',
              'aria-expanded': expanded,
              onClick: toggle,
              title: expanded ? t.cards.collapse : t.cards.expand,
              'aria-label': expanded ? t.cards.collapse : t.cards.expand,
            }, LipiChevron())
            : null,
        ),
      ]
      if (expanded) children.push(h('div', { key: 'body', className: 'dsh-lipi-card-body' }, body))
      return h('article', { className: 'dsh-lipi-card', 'data-tool': toolName }, children)
    }

    /** Компактная строка инструмента до результата (фазы preparing/start). */
    function LipiRunningRow({ toolName, phase, t }) {
      return h('article', { className: 'dsh-lipi-card dsh-lipi-card-running', 'data-tool': toolName, 'data-state': phase },
        h('div', { className: 'dsh-lipi-card-head' },
          h('span', { className: 'dsh-lipi-card-mark' }, LipiMark()),
          h('span', { className: 'dsh-lipi-card-head-main' },
            h('span', { className: 'dsh-lipi-card-head-line' },
              h('span', { className: 'dsh-lipi-card-title' }, toolTitle(t, toolName)),
              h('span', { className: 'dsh-lipi-card-sub' }, t.cards.phase[phase] ?? t.cards.phase.start),
            ),
          ),
        ),
      )
    }

    /** Бейдж проверки: красный при ошибках, жёлтый при предупреждениях, зелёный иначе. */
    function checkBadge(counts, t) {
      const errors = countField(counts.errors) ?? 0
      const warnings = countField(counts.warnings) ?? 0
      if (errors > 0) {
        const text = countText(t, errors, 'error')
        return { tone: 'errors', text: warnings > 0 ? `${text} · ${countText(t, warnings, 'warning')}` : text }
      }
      if (warnings > 0) return { tone: 'warnings', text: countText(t, warnings, 'warning') }
      return { tone: 'clean', text: t.dock.badgeClean }
    }

    /** Сводка проверки для подписи шапки. */
    function checkSubtitle(model, t) {
      const counts = model.counts
      const parts = []
      if (counts.pages !== null) parts.push(countText(t, counts.pages, 'page'))
      if (counts.docs !== null) parts.push(countText(t, counts.docs, 'doc'))
      if (counts.tags !== null) parts.push(countText(t, counts.tags, 'tag'))
      if (model.version !== null) parts.push(t.cards.version(model.version))
      return parts.join(' · ')
    }

    /** Одна находка проверки: код, кликабельный путь и сообщение. */
    function findingNode(finding, index, model, openFile, t) {
      const severityText = finding.severity === 'error' ? t.cards.severity.error : t.cards.severity.warning
      const children = [
        h('span', {
          key: 'severity',
          className: 'dsh-lipi-card-severity',
          style: { color: finding.severity === 'error' ? TONES.errors : TONES.warnings },
        }, `[${severityText}${finding.code !== '' ? ' ' + finding.code : ''}]`),
      ]
      if (finding.file !== '') {
        children.push(' ')
        children.push(pathButton(
          finding.file + (finding.line > 0 ? ':' + finding.line : ''),
          withRoot(model.root, finding.file),
          finding.line,
          openFile,
          'path',
        ))
      }
      if (finding.message !== '') {
        children.push(finding.file !== '' ? ' — ' : ' ')
        children.push(h('span', { key: 'message' }, finding.message))
      }
      return h('div', { key: `finding-${index}`, className: 'dsh-lipi-card-row' }, children)
    }

    /** Тело карточки проверки: находки, обрезка, базовая линия, подсказка версии. */
    function renderCheckCardBody(model, openFile, t) {
      const body = []
      if (model.findings.length > 0) {
        body.push(h('div', { key: 'findings', className: 'dsh-lipi-card-section' },
          h('div', { key: 'title', className: 'dsh-lipi-card-section-title' }, t.cards.findings),
          model.findings.map((finding, index) => findingNode(finding, index, model, openFile, t)),
        ))
      } else {
        body.push(h('div', { key: 'clean', className: 'dsh-lipi-card-empty' }, t.cards.noFindings))
      }
      if (model.truncated && model.truncatedCount > 0) {
        body.push(h('div', { key: 'truncated', className: 'dsh-lipi-card-hint' }, t.cards.truncated(model.truncatedCount)))
      }
      if (model.baseline !== null) {
        body.push(h('div', { key: 'baseline', className: 'dsh-lipi-card-hint' },
          t.cards.baselineHint(model.baseline.known, model.baseline.fixed),
          h('span', { key: 'command', className: 'dsh-lipi-card-code' }, t.cards.baselineCommand),
        ))
      }
      if (model.minLipiHint !== null) {
        body.push(h('div', { key: 'min-lipi', className: 'dsh-lipi-card-hint' }, model.minLipiHint))
      }
      return body
    }

    /** Строка цели среза: кликабельное имя и заголовок с атрибутами. */
    function sliceTargetNodes(target, openFile) {
      const nodes = []
      if (target.path !== '') nodes.push(pathButton(target.name, target.path, 0, openFile, 'name'))
      else nodes.push(h('span', { key: 'name' }, target.name))
      if (target.title !== '') nodes.push(` — ${target.title}`)
      if (target.attrs.length > 0) nodes.push(h('span', { key: 'attrs', className: 'dsh-lipi-card-code' }, ` [${target.attrs.join(', ')}]`))
      return nodes
    }

    /** Один элемент блока среза: сигнал, место в коде, документ или текст. */
    function sliceItemNodes(item, openFile) {
      if (item.kind === 'signal') {
        const nodes = [h('span', { key: 'code', className: 'dsh-lipi-card-code' }, `! ${item.code}`)]
        if (item.path !== '') {
          nodes.push(' ')
          nodes.push(pathButton(`${item.path}${item.line > 0 ? ':' + item.line : ''}`, item.path, item.line, openFile, 'path'))
          nodes.push(' — ')
        } else {
          nodes.push('  ')
        }
        nodes.push(h('span', { key: 'message' }, item.message))
        return nodes
      }
      if (item.kind === 'place') {
        const nodes = [pathButton(`${item.path}${item.line > 0 ? ':' + item.line : ''}`, item.path, item.line, openFile, 'path')]
        if (item.detail !== '') nodes.push(h('span', { key: 'detail', className: 'dsh-lipi-card-code' }, `  ${item.detail}`))
        return nodes
      }
      if (item.kind === 'doc' && item.path !== '') {
        const nodes = [pathButton(item.target, item.path, 0, openFile, 'path')]
        if (item.rest !== '') nodes.push(` — ${item.rest}`)
        return nodes
      }
      return h('span', null, item.kind === 'doc' ? item.text : textField(item.text))
    }

    /** Один блок среза: заголовок, элементы (или выдержка) и строки обрезки. */
    function sliceCardBlock(block, index, openFile, t) {
      const title = t.blocks[block.kind] ?? block.title
      const children = [h('div', { key: 'title', className: 'dsh-lipi-card-section-title' }, title)]
      if (block.kind === 'excerpt') {
        const text = block.items.map((item) => textField(item.text)).filter((line) => line !== '').join('\n')
        if (text !== '') children.push(h('pre', { key: 'excerpt', className: 'dsh-lipi-card-mono' }, text))
      } else {
        children.push(block.items.map((item, itemIndex) => h('div', {
          key: `item-${itemIndex}`,
          className: 'dsh-lipi-card-row',
        }, sliceItemNodes(item, openFile))))
      }
      children.push(block.omitted.map((hint, hintIndex) => h('div', {
        key: `omitted-${hintIndex}`,
        className: 'dsh-lipi-card-hint',
      }, hint)))
      return h('div', { key: `block-${index}`, className: 'dsh-lipi-card-section' }, children)
    }

    /** Тело карточки среза: цель, сводка, блоки, неполнота, примечания. */
    function renderSliceCardBody(model, openFile, t) {
      const body = [h('div', { key: 'target', className: 'dsh-lipi-card-row' }, sliceTargetNodes(model.target, openFile))]
      if (model.summary !== '') body.push(h('div', { key: 'summary', className: 'dsh-lipi-card-row' }, model.summary))
      model.blocks.forEach((block, index) => body.push(sliceCardBlock(block, index, openFile, t)))
      if (model.incomplete) {
        body.push(h('div', { key: 'incomplete', className: 'dsh-lipi-card-hint' }, t.sliceResult.incomplete))
      }
      body.push(model.notes.map((note, index) => h('div', {
        key: `note-${index}`,
        className: 'dsh-lipi-card-hint',
      }, note)))
      return body
    }

    /** Тело карточки нового документа: путь ссылкой, номер, указатель. */
    function renderNewCardBody(model, openFile, t) {
      const body = []
      if (model.path !== '') {
        body.push(h('div', { key: 'path', className: 'dsh-lipi-card-row' },
          h('span', { key: 'label', className: 'dsh-lipi-card-hint' }, t.cards.created),
          pathButton(model.path, model.path, 0, openFile, 'path'),
        ))
      }
      if (model.id !== '') {
        body.push(h('div', { key: 'id', className: 'dsh-lipi-card-hint' }, t.cards.number(model.id)))
      }
      if (model.path !== '') {
        body.push(h('div', { key: 'index', className: 'dsh-lipi-card-hint' },
          model.indexUpdated ? t.cards.indexUpdated : t.cards.indexNotUpdated))
      }
      body.push(model.lines.map((line, index) => h('div', {
        key: `line-${index}`,
        className: 'dsh-lipi-card-row',
      }, line)))
      return body
    }

    /** Тело карточки графа: текст графа моноширинно, пустой граф — подсказка. */
    function renderGraphCardBody(model, t) {
      if (model.text !== '') return [h('pre', { key: 'text', className: 'dsh-lipi-card-mono' }, model.text)]
      return [h('div', { key: 'empty', className: 'dsh-lipi-card-hint' }, t.cards.emptyGraph)]
    }

    /** Строка карты для карточки: кликабельная цель, заголовок, атрибуты и счётчики. */
    function mapRowNodes(row, openFile, t) {
      const nodes = []
      const label = row.target !== '' ? row.target : t.map.targetFallback
      const openPath = row.path !== '' ? row.path : (row.target !== '' && looksLikePath(row.target) ? cleanPath(row.target) : '')
      if (openPath !== '') nodes.push(pathButton(label, openPath, 0, openFile, 'target'))
      else nodes.push(h('span', { key: 'target' }, label))
      if (row.title !== '') nodes.push(` — ${row.title}`)
      const attrs = [row.kind, row.status].filter((part) => typeof part === 'string' && part !== '')
      if (attrs.length > 0) nodes.push(h('span', { key: 'attrs', className: 'dsh-lipi-card-code' }, ` [${attrs.join(', ')}]`))
      nodes.push(h('span', { key: 'counts', className: 'dsh-lipi-card-code' }, `: ${t.map.code} ${row.codeTotal}, ${t.map.tests} ${row.tests}`))
      return nodes
    }

    /** Тело карточки карты: слои, строки, примечание и неполнота. */
    function renderMapCardBody(model, openFile, t) {
      const body = []
      if (model.layers.length > 0) {
        body.push(h('div', { key: 'layers', className: 'dsh-lipi-card-section' },
          h('div', { key: 'title', className: 'dsh-lipi-card-section-title' }, t.cards.layers),
          h('div', { key: 'totals', className: 'dsh-lipi-card-row' }, mapLayerLine(model)),
        ))
      }
      if (model.rows.length === 0) {
        body.push(h('div', { key: 'empty', className: 'dsh-lipi-card-empty' }, t.cards.mapEmpty))
      } else {
        body.push(h('div', { key: 'rows', className: 'dsh-lipi-card-section' },
          model.rows.map((row, index) => h('div', {
            key: `row-${index}`,
            className: 'dsh-lipi-card-row',
          }, mapRowNodes(row, openFile, t)))))
      }
      if (model.note !== '') body.push(h('div', { key: 'note', className: 'dsh-lipi-card-hint' }, model.note))
      if (model.incomplete) body.push(h('div', { key: 'incomplete', className: 'dsh-lipi-card-hint' }, t.cards.mapIncomplete))
      return body
    }

    /** Бейдж карты: число целей, жёлтый тон у пустой карты. */
    function mapBadge(model, t) {
      return {
        tone: model.rows.length > 0 ? 'clean' : 'warnings',
        text: countText(t, model.rows.length, 'target'),
      }
    }

    /** Карточка ошибки: текст ошибки, код возврата, подсказка и детали. */
    function renderToolErrorCard(toolName, model, disclosure, t) {
      const body = [h('div', { key: 'error', className: 'dsh-lipi-card-error' }, model.error)]
      if (model.exitCode !== null) body.push(h('div', { key: 'exit', className: 'dsh-lipi-card-hint' }, t.cards.exitCode(model.exitCode)))
      if (model.hint !== '') body.push(h('div', { key: 'hint', className: 'dsh-lipi-card-hint' }, model.hint))
      if (model.details !== '') body.push(h('pre', { key: 'details', className: 'dsh-lipi-card-mono' }, model.details))
      return h(LipiCardFrame, {
        toolName,
        title: toolTitle(t, toolName),
        badge: { tone: 'errors', text: t.cards.error },
        subtitle: '',
        body,
        disclosure,
        t,
      })
    }

    /** Карточка нераспознанного content: исходный текст как есть. */
    function renderUnparsedCard(toolName, text, disclosure, t) {
      const raw = typeof text === 'string' ? text.trim() : ''
      if (raw === '') {
        return h(LipiCardFrame, {
          toolName,
          title: toolTitle(t, toolName),
          badge: null,
          subtitle: t.cards.noResult,
          body: null,
          disclosure,
          t,
        })
      }
      return h(LipiCardFrame, {
        toolName,
        title: toolTitle(t, toolName),
        badge: null,
        subtitle: t.cards.unparsed,
        body: [
          h('pre', { key: 'raw', className: 'dsh-lipi-card-mono' }, raw),
          h('div', { key: 'hint', className: 'dsh-lipi-card-hint' }, t.cards.unparsedHint),
        ],
        disclosure,
        t,
      })
    }

    /** Карточка проверки: бейдж, сводка, находки, базовая линия. */
    function renderCheckCard(model, text, context) {
      const t = context.t
      if (model === null) return renderUnparsedCard('lipi_check', text, context.disclosure, t)
      if (model.kind === 'error') return renderToolErrorCard('lipi_check', model, context.disclosure, t)
      const body = renderCheckCardBody(model, context.openFile, t)
      return h(LipiCardFrame, {
        toolName: 'lipi_check',
        title: toolTitle(t, 'lipi_check'),
        badge: checkBadge(model.counts, t),
        subtitle: checkSubtitle(model, t),
        body: body.length > 0 ? body : null,
        disclosure: context.disclosure,
        t,
      })
    }

    /** Карточка среза: строка цели, сводка, блоки, примечания. */
    function renderSliceCard(model, text, context) {
      const t = context.t
      if (model === null) return renderUnparsedCard('lipi_slice', text, context.disclosure, t)
      if (model.kind === 'error') return renderToolErrorCard('lipi_slice', model, context.disclosure, t)
      return h(LipiCardFrame, {
        toolName: 'lipi_slice',
        title: toolTitle(t, 'lipi_slice'),
        badge: model.incomplete ? { tone: 'warnings', text: t.cards.mapIncomplete } : null,
        subtitle: model.target.raw,
        body: renderSliceCardBody(model, context.openFile, t),
        disclosure: context.disclosure,
        t,
      })
    }

    /** Карточка нового документа: созданный путь ссылкой. */
    function renderNewCard(model, text, context) {
      const t = context.t
      if (model === null) return renderUnparsedCard('lipi_new', text, context.disclosure, t)
      if (model.kind === 'error') return renderToolErrorCard('lipi_new', model, context.disclosure, t)
      const body = renderNewCardBody(model, context.openFile, t)
      return h(LipiCardFrame, {
        toolName: 'lipi_new',
        title: toolTitle(t, 'lipi_new'),
        badge: null,
        subtitle: model.id !== '' ? model.id : model.path,
        body: body.length > 0 ? body : null,
        disclosure: context.disclosure,
        t,
      })
    }

    /** Карточка графа: сводка и сворачиваемый текст графа. */
    function renderGraphCard(model, text, context) {
      const t = context.t
      if (model === null) return renderUnparsedCard('lipi_graph', text, context.disclosure, t)
      if (model.kind === 'error') return renderToolErrorCard('lipi_graph', model, context.disclosure, t)
      return h(LipiCardFrame, {
        toolName: 'lipi_graph',
        title: toolTitle(t, 'lipi_graph'),
        badge: null,
        subtitle: model.summary,
        body: renderGraphCardBody(model, t),
        disclosure: context.disclosure,
        t,
      })
    }

    /** Карточка карты покрытия: слои, строки целей и примечание. */
    function renderMapCard(model, text, context) {
      const t = context.t
      if (model === null) return renderUnparsedCard('lipi_map', text, context.disclosure, t)
      if (model.kind === 'error') return renderToolErrorCard('lipi_map', model, context.disclosure, t)
      return h(LipiCardFrame, {
        toolName: 'lipi_map',
        title: toolTitle(t, 'lipi_map'),
        badge: mapBadge(model, t),
        subtitle: mapSummaryLine(model, t),
        body: renderMapCardBody(model, context.openFile, t),
        disclosure: context.disclosure,
        t,
      })
    }

    /**
     * Компонент карточки инструмента: фазы preparing/start — компактная
     * строка, фаза result — разбор content и карточка (нераспознанный
     * content — строка с исходным текстом). Язык заголовков берётся из
     * общего кэша `LANG`, который виджет заполняет при загрузке страницы.
     */
    function makeToolCard(toolName, parse, render) {
      return function LipiToolCard(props) {
        const disclosure = props.useDisclosure()
        const lang = useLang()
        const t = stringsFor(lang.current)
        React.useEffect(() => { ensureStyles() }, [])
        const phase = props.phase
        const block = props.block
        const text = phase === 'result' ? contentTextOf(block) : ''
        const isError = phase === 'result' && isRecord(block) && block.isError === true
        const model = React.useMemo(
          () => (phase === 'result' ? parse(text, isError, t) : null),
          [phase, text, isError, t],
        )
        if (phase !== 'result') return h(LipiRunningRow, { toolName, phase, t })
        return render(model, text, { disclosure, openFile: props.openFile, t })
      }
    }

    /** Карточки пяти инструментов бандла для слота `tool.call.toolview`. */
    const LipiCheckCard = makeToolCard('lipi_check', parseCheckContent, renderCheckCard)
    const LipiSliceCard = makeToolCard('lipi_slice', parseSliceContent, renderSliceCard)
    const LipiNewCard = makeToolCard('lipi_new', parseNewContent, renderNewCard)
    const LipiGraphCard = makeToolCard('lipi_graph', parseGraphContent, renderGraphCard)
    const LipiMapCard = makeToolCard('lipi_map', parseMapContent, renderMapCard)

    return {
      inject: ['slots', 'remote', 'remote.commands'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'lipi-status',
          order: 5,
          inject: (sessionId) => ({
            run: async (line) => {
              const r = await ctx.remote.commands.execute(sessionId, line, [])
              if (!r.ok) return { kind: 'error', error: `${r.error.code}: ${r.error.message}` }
              if (r.value === undefined) return { kind: 'error', code: 'notFound' }
              const out = r.value.result
              if (out === undefined || out === null) return { kind: 'error', code: 'noResult' }
              const text = typeof out.text === 'string' ? out.text : ''
              if (out.kind === 'error') return { kind: 'error', code: 'commandFailed', error: text }
              // Каждая команда отдаёт свой вид состояния: проверка — JSON
              // отчёта, срез и карта — JSON, язык — `{current, available}`,
              // init и doctor — обычный вывод.
              const name = String(line).trim().split(/\s+/)[0]
              if (name === '/lipi-init') return { kind: 'init', text }
              if (name === '/lipi-doctor') return { kind: 'doctor', text }
              try {
                const parsed = JSON.parse(text || '{}')
                if (name === '/lipi-slice') return { kind: 'slice', ...parsed }
                if (name === '/lipi-map') return { kind: 'map', ...parsed }
                if (name === '/lipi-lang') return { kind: 'lang', ...parsed }
                return { kind: 'done', ...parsed }
              } catch {
                return { kind: 'error', code: 'unparsed' }
              }
            },
          }),
        }, LipiDock))
        // Карточки результатов инструментов в чате: keyed-слот по имени
        // инструмента по проводу. Неизвестные имена остаются стандартной
        // строке, эти пять ключей заменяются карточками.
        for (const [key, component] of [
          ['lipi_check', LipiCheckCard],
          ['lipi_slice', LipiSliceCard],
          ['lipi_new', LipiNewCard],
          ['lipi_graph', LipiGraphCard],
          ['lipi_map', LipiMapCard],
        ]) {
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
            name: 'tool.call.toolview',
            key,
          }, component))
        }
      },
    }
  },
})
