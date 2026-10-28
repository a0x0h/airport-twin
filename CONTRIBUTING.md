# Contributing

Thanks for taking the time to help. Bug reports, ideas and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/a0x0h/airport-twin.git
cd airport-twin
npm ci
npm run dev        # http://localhost:5180
```

Requires Node.js 20 or newer.

## Before you open a pull request

1. Branch from `main` (`feat/short-name`, `fix/short-name`).
2. Keep the change focused. One feature or fix per PR.
3. Run `npm run build`. It type-checks (`tsc -b`) and bundles. CI runs the same command.
4. If you touch the simulation (`src/sim/`), check that a fixed seed still replays the same run and say in the PR how the metrics moved.
5. Add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased**.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add a second security checkpoint
fix: stop taxis from queueing through the curb
docs: explain the Lab confidence intervals
```

## Project layout

| Path | What lives there |
| --- | --- |
| `src/sim/` | Discrete-event simulation: passengers, queues, parking, experiments |
| `src/scene/` | three.js scenes (`Hall`, `Diorama`, lighting) |
| `src/kit/` | Hand-built 3D objects and materials |
| `src/ui/` | Overlay, timeline, Lab and data panels |
| `src/data/` | Synthetic schedule and recorded real-day loader |
| `scripts/` | Data tools such as `fetch-mhd.mjs` |
| `public/data/mhd/` | Recorded days and Popular-times reference data |

## Reporting bugs

Open an [issue](https://github.com/a0x0h/airport-twin/issues/new/choose) with the steps, the seed if relevant, your browser and a screenshot.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
