# MEP HVAC design assistant (preliminary)

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

Packaging verification is limited to an **unpacked Linux package**: `TEST_ELECTRON_PACKAGED=1 npm run test:electron` builds it with `electron-builder --linux --dir` into `dist/linux-unpacked/` and runs the boot, DXF-import and DWG-import smoke tests (E1, E4, E5) against `mep-hvac`, including the libredwg wasm loaded from inside `app.asar`. No installer (AppImage, snap, deb, NSIS, dmg) has been built or installed, nothing is code-signed or notarized, and Windows and macOS builds are untested. `appId` (`com.mep.hvac`) and the `.deb` maintainer in `electron-builder.yml` are neutral placeholders to replace before distribution.


## Engineering validation

Run all engine tests with `npm test` (Vitest suites plus legacy assertion and Node tests). Run only Vitest suites with `npm run test:engine`, or filter by basename: `npm test -- deploymentIntegrity`. Use `npm run typecheck` and `npm run build` for application verification.

GUI checks: `npm run test:gui` (headless Chromium, `e2e/`) and `npm run test:electron` (real Electron, Linux/Xvfb only).

The engine uses canonical feet, Btu/h and CFM internally. Project units and drawing scale are normalized before calculations. Invalid geometry and loads block calculations; no feasible catalog record blocks selection. Optimizer Studio applies CAD designs through a transaction that rechecks current inputs, locked components, flow, connected pressure paths and geometry. Air Distribution Schedules are preliminary and cannot bypass that transaction.

These checks do not certify a construction-ready design. All outputs are preliminary (`issueReady: false`). The real-Electron smoke suite (`npm run test:electron`) runs on Linux under Xvfb only; Windows/macOS builds, installers and signing are unverified. CAD import is tested only with generated fixtures (DXF written by ezdxf, DWG written by LibreDWG, which is also the app's DWG reader), never with drawings authored in AutoCAD or Revit. Excel catalogs loaded in the app do not affect equipment recommendations, the bundled catalogs have no verified manufacturer provenance, and the duct pressure model is simplified. The shared load model is preliminary; building envelope/solar inputs, manufacturer operating conditions, outdoor-air arrangements, 3D coordination and full safety review still require verification. Review [the audit](docs/audits/2026-10-08-cad-hvac-engine-audit.md) and [current implementation status](docs/audits/2026-10-08-engineering-integrity-status.md) before engineering use.
