# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- People are remodelled with rounded limbs, hands, shoes, a neck and varied hair (short, long, bun, headscarf); backpacks have straps and roller bags a ribbed shell.
- Cars have bumpers, sills, mirrors, door pillars, lacquered paint and tinted glass. Glass everywhere reflects the sky more strongly.

### Added
- Lab: five course-style discrete-event simulation problems (M/M/1 customs desk, M/G/c check-in sizing, M/G/c/c car park, queues in series, a terminating day with time-varying arrivals). Each is solved step by step: conceptual model, input modelling, simulation table and event trace, warm-up and replications, confidence intervals, verification against Erlang B, Erlang C and Allen-Cunneen, and a paired comparison of alternatives that answers the question.
- A small traceable event-scheduling engine (`src/sim/des`) with a future event list, common random numbers and non-stationary Poisson arrivals by thinning.
- Open-source project files: MIT license, contributing guide, code of conduct, security policy.
- GitHub Actions CI build.
- Issue and pull-request templates, and Dependabot.

## [0.9.0]

### Added
- P1, a 96-bay car park with its own parking simulation: barrier, road queue and drivers who give up.
- Real days at MHD: AeroDataBox flights and METAR weather recorded by `npm run fetch:mhd`, replayable in the twin and the Lab.
- A "Crowding vs Google" chart against Google Maps Popular times.

## [0.8.0]

### Added
- Arrivals with baggage claim, greeters and a live taxi rank.
- Phone layout.

## [0.7.0]

### Added
- Design comparison (MHD today vs proposed) and the experiments Lab with paired replications and 95% confidence intervals.
- Mood and crowding overlays.

## [0.1.0] – [0.6.0]

### Added
- Object kit, check-in, security, gates and boarding, Mashhad terminal detail.

[Unreleased]: https://github.com/a0x0h/airport-twin/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/a0x0h/airport-twin/releases/tag/v0.9.0
