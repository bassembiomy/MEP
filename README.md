# -

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```


## Engineering validation

Run all engine tests with `npm test` (Vitest suites plus legacy assertion and Node tests). Run only Vitest suites with `npm run test:engine`, or filter by basename: `npm test -- deploymentIntegrity`. Use `npm run typecheck` and `npm run build` for application verification.

The engine uses canonical feet, Btu/h and CFM internally. Project units and drawing scale are normalized before calculations. Invalid geometry and loads block calculations; no feasible catalog record blocks selection. Optimizer Studio applies CAD designs through a transaction that rechecks current inputs, locked components, flow, connected pressure paths and geometry. Air Distribution Schedules are preliminary and cannot bypass that transaction.

These checks do not certify a construction-ready design. The shared load model is preliminary; building envelope/solar inputs, manufacturer operating conditions, outdoor-air arrangements, 3D coordination and full safety review still require verification. Review [the audit](docs/audits/2026-10-08-cad-hvac-engine-audit.md) and [current implementation status](docs/audits/2026-10-08-engineering-integrity-status.md) before engineering use.
