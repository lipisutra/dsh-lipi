# dsh-lipi

<p align="center"><img src="docs/assets/logo.png" alt="LipiSutra" width="420"></p>

<h3 align="center">DeepSeek Harness bundle for lipi-managed projects.</h3>

<p align="center">Check. Slice. Map. Write.</p>

<p align="center">
  <a href="https://github.com/lipisutra/dsh-lipi/actions/workflows/ci.yml"><img src="https://github.com/lipisutra/dsh-lipi/actions/workflows/ci.yml/badge.svg?branch=master" alt="test"></a>
  <img src="https://img.shields.io/github/v/release/lipisutra/dsh-lipi?color=e8731a" alt="release">
  <img src="https://img.shields.io/badge/lipi-%E2%89%A5%201.0.0-e8731a" alt="lipi 1.0.0 or newer">
  <img src="https://img.shields.io/badge/license-MIT-4a7bb5" alt="MIT">
</p>

Native DeepSeek Harness bundle for projects managed with lipi. It adds the
`lipi_check`, `lipi_slice`, `lipi_map`, `lipi_graph`, and `lipi_new` tools, the
`/lipi-check`, `/lipi-slice`, `/lipi-init`, `/lipi-doctor`, `/lipi-map`, and
`/lipi-lang` commands, a status widget in the composer dock, result cards in the
chat, and the built-in `lipi` skill.

The checks themselves are run by the installed `lipi` command; the bundle
changes neither lipi nor the project rules.

Documentation: [English edition](docs/en/README.md) ·
[Russian edition](docs/ru/README.md).

## Requirements

- lipi 1.0.0 or newer: `pipx install git+https://github.com/lipisutra/lipi`
  (Python 3.9+);
- DeepSeek Harness 0.2.2-rc.3 or newer;
- a project deployed with lipi: `lipi.json` in its root (`lipi init`).

## Install

1. Install lipi and check `lipi --version`.
2. Add `@lipisutra/dsh-lipi` to a DeepSeek Harness profile and enable the bundle
   in Plugin Manager. A local bundle cannot be installed from a
   `\\wsl.localhost\...` path, so copy the package to a local disk first.
3. If PATH does not see the `lipi` command, set its path in `lipiPath`.

## Development

```bash
npm test                 # node --test test/*.test.mjs
node scripts/vendor.mjs  # refresh the skill references from the installed lipi
lipi check               # documentation checks
lipi audit               # full audit
```

Rules for changing the package are in [.agents/README.md](.agents/README.md).

## License

MIT
