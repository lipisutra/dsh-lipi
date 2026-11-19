# dsh-lipi

<p align="center"><img src="../assets/logo.png" alt="LipiSutra" width="360"></p>

<p align="center">DeepSeek Harness bundle for lipi-managed projects.</p>

Native DeepSeek Harness bundle for projects managed with lipi. It gives the
agent a slice for a task, a coverage map, a documentation check, and new
workflow documents; the checks are run by the installed `lipi` command, and the
bundle changes neither lipi nor the project. The bundle card is
[DETAIL.md](DETAIL.md).

lipi is a documentation tool: it lays out the project's agent rules
(`AGENTS.md`, `.agents/lipi/`), documentation (`docs/`), and workflow documents
(`workflow/`). The installed `lipi check` command validates the project: broken
links, page size and header rules, a stale workflow index, and drift between
documentation and code. The bundle does not look for a checker inside the
project: a project counts as deployed when its root holds `lipi.json`.

## What the bundle adds <a id="parts"></a>

| Part | Details |
| --- | --- |
| Agent tools | `lipi_check` — runs the installed `lipi check` in the project in `quick`, `staged`, and `audit` modes; `lipi_slice` — a slice of the project knowledge map by target (section, page, code file, or work number) or by changes (`--diff`, `--staged`); `lipi_map` — the coverage map: documentation targets, code layers, and tests with their counts; `lipi_graph` — the project link graph: an impact subgraph around a node, orphans, explicit anchors without `@trace`, the staleness chain for staged/diff, type filtering, and mermaid/dot export; `lipi_new` — plans, issues, decisions, and other workflow documents through `lipi new` |
| Host commands | `/lipi-check`, `/lipi-slice`, `/lipi-init`, `/lipi-doctor`, `/lipi-map`, and `/lipi-lang` do the same from the chat; `/lipi-lang` without an argument shows the interface language, and with a code (`/lipi-lang ru`) it switches |
| Chat cards | Results of `lipi_check`, `lipi_slice`, `lipi_new`, `lipi_map`, and `lipi_graph` render as cards through the `tool.call.toolview` slot: a status badge, clickable file paths, slice blocks, and map rows; unrecognized output stays text |
| Dock widget | A compact icon with a state indicator (green — clean, yellow — warnings, red — errors) and a dropdown: a summary, `quick`/`staged`/`audit` runs, a slice by target (`lipi slice`), the coverage map (`lipi map`), `lipi init` in a folder without the scaffold, `lipi doctor`, a language switch, and the list of findings |
| Language | The language of the interface and cards is the lipi language: currently `en` and `ru`, and other languages come from the translation catalog of the installed package without bundle changes. The skill references exist for every documentation edition |
| Skill | `skills/lipi/SKILL.md` — when to check, how to deploy, how to start a task with a slice |
| Skill references | `skills/lipi/references/<language>/*` — copies of every lipi documentation edition; `setup.md` — the deployment guide; `version.json` — the lipi version and the minimum |
| Text sync | `scripts/vendor.mjs` — checks compatibility with lipi and refreshes copies of all editions |

## Getting started <a id="start"></a>

1. Install lipi on the machine (Python 3.9+):

   ```bash
   pipx install git+https://github.com/lipisutra/lipi
   lipi --version
   ```

   Upgrade it with `pipx upgrade lipi`. On Windows lipi may run through WSL; for
   projects opened by a `\\wsl.localhost\...` path the command runs inside WSL,
   and the distribution is set by `wslDistro`.
2. Add the `@lipisutra/dsh-lipi` package to a DeepSeek Harness profile and
   enable the bundle in Plugin Manager. A local bundle cannot be installed from
   a WSL directory (Windows cannot reference `\\wsl.localhost\...`), so copy the
   package to a local disk, for example `C:\Users\<name>\projects\lipi-dsh`, and
   point Plugin Manager at that copy; the source stays in WSL.
3. Make sure the project is deployed with lipi: `lipi.json` in its root (created
   by `lipi init`); `.agents/lipi/lipi.lock` next to it holds the deployment
   version. Without the scaffold, run `lipi init` for a new or existing project.
4. Ask the agent to check the documentation, call `/lipi-check`, or call the
   `lipi_check` tool.

If PATH does not see the `lipi` command, set its path in `lipiPath`. Node.js is
needed only for `scripts/vendor.mjs`.

## Configuration <a id="config"></a>

Bundle configuration keys and their defaults:

| Key | Default | What it sets |
| --- | --- | --- |
| `lipiPath` | empty | Path to the installed lipi command; empty means the `lipi` command from PATH. |
| `wslDistro` | `Ubuntu` | The WSL distribution that runs the installed lipi when a project is opened by a `\\wsl.localhost\...` path on Windows. |
| `maxItems` | `50` | The limit on errors and, separately, warnings in the `lipi_check` output. |
| `maxNodes` | `200` | The limit on nodes in the `lipi_graph` output. |
| `maxEdges` | `400` | The limit on edges in the `lipi_graph` output. |

For a project opened through WSL, `lipiPath` is the path to the command inside
the distribution; empty means the `lipi` command from that distribution's PATH.

## Versions and text sync <a id="versions"></a>

The bundle version is independent of the lipi version. The package declares the
minimum compatible version in `package.json` (`"lipi": {"min": "1.0.0"}`), and a
project check compares it with the version of the installed lipi from the JSON
output of `lipi check`: when it is older than the minimum, the result carries a
hint to upgrade lipi. The skill references are copies of the installed lipi
texts: documentation editions from `share/lipi/docs/<language>/*` (as many
directories as there are, so many copies appear — the language list is not
hardcoded) and `share/lipi/SETUP.md`. When the installed package does not ship
`share/lipi` (an editable install), they are taken from the release tag
`v<first digit of the version>` of `lipisutra/lipi`. In the repository, the
copies are refreshed by

```bash
node scripts/vendor.mjs
```

The script finds the installed lipi command (`LIPI_BIN` or PATH), determines
Python from its shebang, and takes the data directory through `sysconfig`; it
reads the version from `lipi --version` and exits with code 1 without copying
anything when `lipi < lipi.min`. On success it refreshes the copies and
`skills/lipi/references/version.json` (`{"lipi": "<version>", "min": "1.0.0"}`)
and removes stale files of the previous layout. A bundle test compares the
copies with the files of the installed package and is skipped when `share/lipi`
is unavailable.

## Caveat <a id="caveat"></a>

The package changes neither lipi nor the project rules: the checks are run by
the installed command, and the rules live in `AGENTS.md` and `.agents/lipi/`.
The project does not depend on the bundle — `lipi check` and `lipi new` work
without DeepSeek Harness too.
