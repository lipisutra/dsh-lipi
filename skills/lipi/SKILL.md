---
name: lipi
description: Разворачивает в проекте каркас документации lipi и проверяет документацию по его правилам; применяйте, когда проект ведётся по lipi или пользователь просит развернуть lipi, проверить описание перед коммитом либо завести план или замечание.
whenToUse: В проекте есть lipi.json или правила lipi в AGENTS.md, либо нужен развёрнутый каркас и установленная команда lipi.
---

# lipi

lipi — инструмент ведения документации проекта: раскладывает правила исполнителя,
описание и рабочие материалы, а установленная команда `lipi` проверяет ссылки,
размеры, шапки документов, актуальность указателя и связи описания с кодом.
Описание может быть на нескольких языках: редакции `docs/en/*` и `docs/ru/*`
обязательны, и у каждой свой `README.md`.

## Когда применять

- Проект уже ведётся по lipi: перед коммитом и перед сложной задачей.
- Пользователь просит развернуть lipi в новом или существующем проекте.
- Нужно завести план, замечание, решение или другой рабочий документ.
- Нужен срез по задаче, карта покрытия или разбор устаревания.
- Правило или проверка lipi мешает работе.

## Развернуть

Из корня проекта:

```bash
lipi init                        # новый или существующий проект, пакет
lipi init --type app             # приложение
lipi init --dry-run              # только показать план, без записи
```

Язык интерфейса и заготовок выбирается до первого `lipi init`: `lipi lang ru`
(по умолчанию `en`). Строгость задаёт ключ `"enforce": true` в `lipi.json` —
при первом развёртывании его включает `lipi init --enforce`, смену ключа
применяет повторный `lipi init`: тогда lipi ставит pre-commit
`lipi check --staged`, и ошибки не проходят до коммита. При `"enforce": false`
(по умолчанию) лишний хук lipi убирает.

Если команды `lipi` нет: `pipx install git+https://github.com/lipisutra/lipi`
(Python 3.9+), обновление — `pipx upgrade lipi`. Проект считается развёрнутым,
когда в его корне есть `lipi.json`; признак применённых правил —
`.agents/lipi/lipi.lock`.

Порядок: определить случай (новый или существующий проект), уточнить тип
проекта и место рабочих материалов, посмотреть `lipi init --dry-run`,
применить, запустить `lipi check`, заполнить `docs/README.md`, сообщить
пользователю. Коммит — только по просьбе. Полная инструкция —
`references/setup.md`.

## Рабочий цикл

- **Начинай задачу со `lipi slice`** по её цели: раздел
  (`docs/pricing.md#threshold`), страница, файл кода или номер работы
  (`ISS-007`); по изменениям — `lipi slice --diff <база>` или `--staged`.
  Срез только читает и собирает правила, сигналы, места в коде и тесты.
- Карта покрытия — `lipi map`: где цели описания связаны с кодом и тестами;
  ноль означает «связей не найдено», а не «нет реализации». Граф связей и
  цепочки устаревания — `lipi check --structure` (в DSH — `lipi_graph`).
- Перед коммитом: `lipi check` (`--staged` — по индексу Git, `--diff A...B` —
  по диапазону, `--format json` — для инструментов). В DSH — инструмент
  `lipi_check` с режимами `quick`, `staged`, `audit`.
- Перед сложной или ответственной задачей и перед выпуском: `lipi audit`.
- Новый документ: `lipi new pln "Название"`, `lipi new iss "Что мешает"`;
  у замечания вид — `bug`, `friction`, `request` или `question`.
  В DSH — инструмент `lipi_new`.
- После добавления, переноса или переименования рабочих документов:
  `lipi index` — он пересобирает полный комплект указателей.
- Разобранный A4 отмечай через `lipi review`, а не правкой даты описания ради
  тишины: `lipi review <путь#якорь> --at <файл[:строка]>` показывает пару и
  token, подтверждение — та же команда с `--confirm TOKEN --by <автор>
  --reason <объяснение>`.
- Перенос страницы или каталога — `lipi mv`; рабочие материалы в старом
  формате — `lipi migrate`. Диагностика развёртывания — `lipi doctor`,
  версия и путь к чекеру — `lipi version --path`.

## В DeepSeek Harness

Инструменты: `lipi_check` (режимы `quick`, `staged`, `audit`), `lipi_slice`,
`lipi_map`, `lipi_graph`, `lipi_new`; команды хоста: `/lipi-check`,
`/lipi-slice`, `/lipi-map`, `/lipi-init`, `/lipi-doctor`, `/lipi-lang`. Они
вызывают ту же установленную команду `lipi` и возвращают результат карточкой
в чате; если карточка не распознала вывод, он остаётся текстом. Нестандартный
путь к команде задаёт настройка `lipiPath`.

## Язык и редакции описания

`lipi lang` показывает текущий язык интерфейса, `lipi lang <код>` выбирает его
для всех проектов (выбор хранится в `~/.config/lipi/config.json`); без перевода
используется английский. Отдельно языковые редакции описания задаёт ключ
`languages` в `lipi.json`: `default` — редакция по умолчанию (каталог `docs`),
`editions` — каталоги редакций, `required` — языки, где страница обязательна.
Сейчас обязательны `en` и `ru`, но список языков не зашит: справочники скилла
собраны по каталогам `docs/<код>/` установленного lipi.

## Если правило мешает

Не обходите правило молча: заведите замечание

```bash
lipi new iss "Что мешает и в какой ситуации" friction lipi
```

и скажите пользователю. Обязанность завести замечание берётся из правил
проекта; скилл только напоминает. Если рабочие материалы не подключены
(`"workflow": null`), замечание пишется в `.agents/lipi-feedback/` — там его
видит чекер и собирает `lipi collect`.

## Справочники

Все справочники — копии документации установленного lipi и лежат рядом со
скиллом в `skills/lipi/references/`. Общая инструкция по развёртыванию —
`references/setup.md` (корневой `SETUP.md` lipi, один для обеих редакций).

| Страница | Русская редакция | English edition |
| --- | --- | --- |
| Оглавление редакции | `references/ru/README.md` | `references/en/README.md` |
| Команды | `references/ru/commands.md` | `references/en/commands.md` |
| Проверки и режимы | `references/ru/checking.md` | `references/en/checking.md` |
| Правила и их причины | `references/ru/rules.md` | `references/en/rules.md` |
| Настройки `lipi.json` | `references/ru/settings.md` | `references/en/settings.md` |
| Коды проверок | `references/ru/codes.md` | `references/en/codes.md` |
| Рабочие материалы и указатели | `references/ru/workflow.md` | `references/en/workflow.md` |
| Срез перед задачей | `references/ru/slice.md` | `references/en/slice.md` |
| Срез по изменениям | `references/ru/slice-diff.md` | `references/en/slice-diff.md` |
| Формат ответа среза | `references/ru/slice-output.md` | `references/en/slice-output.md` |
| Примеры среза | `references/ru/slice-examples.md` | `references/en/slice-examples.md` |
| Карта покрытия | `references/ru/map.md` | `references/en/map.md` |
| Перенос страниц | `references/ru/move.md` | `references/en/move.md` |
| Просмотр A4 | `references/ru/review.md` | `references/en/review.md` |
| Примеры просмотра A4 | `references/ru/review-examples.md` | `references/en/review-examples.md` |

`references/version.json` — снимок: версия установленного lipi и минимальная
совместимая версия. Копии обновляет `node scripts/vendor.mjs` из корня пакета
`@lipisutra/dsh-lipi`; если относительная ссылка из скилла не открывается,
ищите файлы в каталоге `skills/lipi/references/`.
