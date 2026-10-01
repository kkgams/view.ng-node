# Owner publishing procedure

Distribution is a GitHub Release ZIP, not npm registry or OCI. Prepared version:
0.1.0 / v0.1.0. Preparation never pushes or tags.

1. Review source closure, LICENSE, NOTICE and NOTICE-EVIDENCE.json.
   Apache-2.0 is the owner's standing choice for GAMS-authored code. Identified
   98.css CSS/artwork portions retain their complete MIT terms in theme NOTICE.
   Its comparison snapshot is not a claim of the original imported version.
2. Run `npm test` with Node 24 and Python 3. Review source bytes and deployment paths.
3. Set repository Actions variables `LICENSE_SHA256` and `NOTICE_SHA256` from
   `shasum -a 256 LICENSE NOTICE`. These bind publication to the collected exact
   texts; they are not a repeated license-choice decision. Source/evidence/text
   changes require recollection and updated digests before distribution.
4. Push the reviewed `release` branch. With both variables, branch CI builds,
   verifies and uploads a candidate. Without them, only tests run; no candidate
   is distributed. A wrong nonempty digest or changed evidence fails loudly.
5. Review the branch candidate; after successful verification and Host consumption,
   create and push `v0.1.0` at the current release HEAD. Never move a pushed tag.
   Tag CI independently tests, checks branch/tag/version, stages and checks a
   fresh ZIP. The publish job rechecks identity, bytes and SHA256SUMS. GitHub API
   errors fail closed. Only version tags create **public** releases.
6. Any existing GitHub Release, including draft, blocks creation. No overwrite
   path. Recover with a new version rather than replacing published assets.

Local rehearsal after exporting APPROVED_LICENSE_SHA256 and
APPROVED_NOTICE_SHA256:

```sh
python3 scripts/release.py stage --tag v0.1.0
python3 scripts/release.py check --tag v0.1.0
```

Staging output must not already exist. ZIP contains deployment paths without
`src/`, LICENSE, NOTICE, README.md and unit.json. SHA256SUMS is a sidecar. Install
source files at their mapped Project-relative paths; retain metadata and notices
under `notices/project-units/<repository>/`, never over the Project's own files.
Install dependencies separately. The example's pinned installer automates this.
The target Host source contract is 2.0.3; package-level GUI validation is a release
gate, not an assertion that every later Host is compatible.
