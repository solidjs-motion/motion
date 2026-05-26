# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] — 2026-05-25

### Fixed

- `motion@0.2.1`: `layoutId` handoff applies the consumer's
  `layoutScroll` ancestor offsets when computing `initialFirst`, so
  shared-element FLIPs inside a scrolled `layoutScroll` container no
  longer start from the donor's pre-scroll position. See
  `packages/motion/CHANGELOG.md` for detail.

## [0.1.0] — 2026-05-20

### Added

- Initial workspace scaffold: Bun-workspaces monorepo with `packages/motion` and `examples/basic`.
- Biome 2 for lint and format.
- Shared TypeScript base config with strict mode and `noUncheckedIndexedAccess`.
