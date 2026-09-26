# view.ng-node

Initial prerelease extraction of the GAMS `view` Project Unit from
`views/view-ng-node.js`. Source behavior is intentionally unchanged.
A separate internal configured View Project Unit; it is not bundled into view.ng.

## Install mapping

Copy `src/views/view-ng-node.js` to the Project-relative path `views/view-ng-node.js` and configure
that path in the Host's current Project configuration. This snapshot does not claim
a stable public package/install format.

## Current prerelease Host contract

This Unit runs inside the GAMS Host. Absolute JavaScript imports under `/core`,
`/util`, and `/widgets` are Host-owned package-library APIs and are deliberately not
vendored here. In particular, `/core/runtime.js` supplies plugin calls. There is no
arbitrary shared SDK repository. The Host must also provide the browser DOM/custom
elements environment and base/theme semantic CSS contract expected by the source.

Repository dependencies in this extraction set:
- `ui-service.popup`
- `view.code`
- `view.files`

These are repository names only. Deployed JavaScript filenames and Project Config ids
remain unchanged. The list records actual static configuration/call boundaries; it
does not claim that every interaction has a standalone dynamic integration test.

## Verify

Requires Node.js 20 or newer.

```sh
npm test
```

Verification scans Unit-owned `src/` assets plus its test script/package/workflow
metadata, checks each JavaScript file in that boundary with `node --check`, rejects
unresolved or escaping local imports/assets, permits only the documented Host
absolute import roots, and resolves non-data CSS `url(...)` assets. Git internals,
dependency installs, and build outputs are outside the scan boundary.

## Release status

Package and binary redistribution is blocked, and `package.json` is private. The
copyright owner may push source with all rights reserved after reviewing permissions
for a public source push. See `LICENSING.md`. This repository has no publish workflow.
