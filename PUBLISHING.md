# Owner publishing procedure

Distribution is a GitHub Release ZIP, not npm registry or OCI. Prepared version:
0.2.0 / v0.2.0. Preparation never pushes or tags.

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
   create and push `v0.2.0` at the current release HEAD. Never move a pushed tag.
   Tag CI independently tests, checks branch/tag/version, stages and checks a
   fresh ZIP. The publish job rechecks identity, bytes and SHA256SUMS. GitHub API
   errors fail closed. Only version tags create **public** releases.
6. Any existing GitHub Release, including draft, blocks creation. No overwrite
   path. Recover with a new version rather than replacing published assets.

Local rehearsal after exporting APPROVED_LICENSE_SHA256 and
APPROVED_NOTICE_SHA256:

```sh
python3 scripts/release.py stage --tag v0.2.0
python3 scripts/release.py check --tag v0.2.0
```

Staging output must not already exist. ZIP contains deployment paths without
`src/`, LICENSE, NOTICE, README.md and unit.json. SHA256SUMS is a sidecar. Install
source files at their mapped Project-relative paths; retain metadata and notices
under `notices/project-units/<repository>/`, never over the Project's own files.
Install dependencies separately. The example's pinned installer automates this.
The target Host source contract is 2.0.3; package-level GUI validation is a release
gate, not an assertion that every later Host is compatible.

## Coordinated local preparation (not release-ready)

Own version v0.2.0 is prospective, not a published download or dependency pin.
The retained, verified source Host target is 2.0.3; no 2.1.0 GUI claim is made.
SOURCE.json preserves the historical extraction snapshot and appends a separate
metadata and bounded test-fixture maintenance delta. NOTICE-EVIDENCE.json audits
the src closure and its recorded extra inputs, NOT the complete prepared tree.
Evidence, NOTICE, LICENSE and upstream terms retain their original bytes.

Current release/PR workflows and the standalone publisher remain unchanged:
digest-gated branch candidates, fresh tag stage/check and authenticated absence
checks precede direct public creation. There is no common publisher migration,
private-draft byte rehearsal, immutable-policy gate or stable anonymous public
byte recheck. Recorded immutable policy was disabled; no fresh remote check was
performed. Metadata proof and local stage/check do not clear these blockers or
GUI/Host consumption gates. Existing releases/tags must never be overwritten.
The standalone protocol tests retain synthetic v0.1.0 fixtures. Their setup now
temporarily binds release.__file__ to the synthetic root, with unittest cleanup,
so branch() reads that fixture's package instead of this checkout's version.
Stock npm test validates the prepared checkout directly. Tag/version mismatch
and other production gates remain strict; no production code is changed.
