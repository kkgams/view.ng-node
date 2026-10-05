# Context: view.ng-node

## Responsibility

This repository owns exactly one View Project Unit entry and any recursively
required repository-local assets. It does not own the GAMS Host, runtime, shared
`/core`, `/util`, or `/widgets` APIs, or sibling Project Units.

## Boundary

- Project deployment path: `views/view-ng-node.js`.
- Absolute Host imports remain absolute and are supplied by GAMS.
- Dependencies on separately configured views/services stay separate.

## Maturity

Initial station-showcase extraction slice. Host/config contracts are prerelease and
may change before public ecosystem release.
