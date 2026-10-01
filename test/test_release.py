import io
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/release.py'
SPEC = importlib.util.spec_from_file_location('release', SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        (self.root / 'src/views').mkdir(parents=True)
        (self.root / 'src/views/unit.js').write_bytes(b'import "./asset.js"\n')
        (self.root / 'src/views/asset.js').write_bytes(b'export const asset = 1\n')
        (self.root / 'package.json').write_text(json.dumps({
            'name': 'view.example', 'version': '0.1.0', 'private': True,
            'license': 'Apache-2.0', 'files': ['src/views/unit.js', 'src/views/asset.js']}))
        (self.root / 'release.json').write_text(json.dumps({'kind': 'view', 'entry': 'views/unit.js'}))
        for name in ('LICENSE', 'NOTICE', 'README.md'):
            (self.root / name).write_text(name + '\n')
        evidence = {'files_sha256': {p: release.digest((self.root / p).read_bytes())
                    for p in ('src/views/unit.js', 'src/views/asset.js')}}
        proof = json.dumps(evidence).encode()
        (self.root / 'NOTICE-EVIDENCE.json').write_bytes(proof)
        (self.root / 'NOTICE').write_text('NOTICE\nNOTICE-EVIDENCE.json SHA-256: ' + release.digest(proof) + '\n')
        self.env = {f'APPROVED_{name}_SHA256': release.digest((self.root / name).read_bytes())
                    for name in ('LICENSE', 'NOTICE')}
        self.env['GITHUB_REPOSITORY'] = 'kkgams/view.example'
        self.patch = patch.dict(os.environ, self.env)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.out = Path(self.temp.name) / 'candidate'

    def stage(self):
        release.stage(self.root, self.out, 'v0.1.0')

    def check(self):
        release.check(self.root, self.out, 'v0.1.0')

    def test_real_zip_determinism_and_mapping(self):
        self.stage()
        self.check()
        second = Path(self.temp.name) / 'second'
        release.stage(self.root, second, 'v0.1.0')
        name = 'view.example-0.1.0.zip'
        self.assertEqual((self.out / name).read_bytes(), (second / name).read_bytes())
        with zipfile.ZipFile(self.out / name) as z:
            self.assertEqual(set(z.namelist()), {'views/unit.js', 'views/asset.js', 'LICENSE', 'NOTICE', 'README.md', 'unit.json'})
            unit = json.loads(z.read('unit.json'))
            self.assertEqual(unit['files']['views/asset.js'], release.digest(z.read('views/asset.js')))
            self.assertEqual(unit['host']['target'], '2.0.3')
            self.assertNotIn('tested', unit['host'])

    def test_changed_checksum(self):
        self.stage()
        (self.out / 'SHA256SUMS').write_text('bad')
        with self.assertRaises(ValueError):
            self.check()

    def test_changed_content_even_with_recomputed_checksum(self):
        self.stage()
        name, files = release.payload(self.root, 'v0.1.0')
        files['views/asset.js'] = b'changed'
        data = release.archive(files)
        (self.out / name).write_bytes(data)
        (self.out / 'SHA256SUMS').write_text(f'{release.digest(data)}  {name}\n')
        with self.assertRaises(ValueError):
            self.check()

    def test_workflow_repository_identity(self):
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'kkgams/view.wrong'}):
            with self.assertRaisesRegex(ValueError, 'canonical Project Unit identity'):
                self.stage()

    def test_license_notice_and_missing_approval(self):
        for key in ('APPROVED_LICENSE_SHA256', 'APPROVED_NOTICE_SHA256'):
            with patch.dict(os.environ, {key: ''}):
                with self.assertRaises(ValueError):
                    self.stage()
        (self.root / 'LICENSE').write_text('changed')
        with self.assertRaises(ValueError):
            self.stage()
        (self.root / 'NOTICE').write_text('PROVENANCE_PENDING')
        with patch.dict(os.environ, {'APPROVED_NOTICE_SHA256': release.digest(b'PROVENANCE_PENDING')}):
            with self.assertRaises(ValueError):
                release.approved(self.root)

    def test_tag_mismatch(self):
        with self.assertRaises(ValueError):
            release.stage(self.root, self.out, 'v0.2.0')
        with self.assertRaises(ValueError):
            release.branch('v0.2.0')

    def test_missing_inputs_no_source_fallback(self):
        self.out.mkdir()
        with self.assertRaises(ValueError):
            self.check()
        self.out.rmdir()
        self.stage()
        (self.out / 'view.example-0.1.0.zip').unlink()
        with self.assertRaises(ValueError):
            self.check()

    def test_duplicate_output(self):
        self.stage()
        with self.assertRaises(FileExistsError):
            self.stage()
        package = json.loads((self.root / 'package.json').read_text())
        package['files'].append(package['files'][0])
        (self.root / 'package.json').write_text(json.dumps(package))
        with self.assertRaises(ValueError):
            release.payload(self.root, 'v0.1.0')

    def test_duplicate_zip_entries(self):
        self.stage()
        name, files = release.payload(self.root, 'v0.1.0')
        stream = io.BytesIO(release.archive(files))
        with zipfile.ZipFile(stream, 'a') as z:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                z.writestr('views/asset.js', files['views/asset.js'])
        data = stream.getvalue()
        (self.out / name).write_bytes(data)
        (self.out / 'SHA256SUMS').write_text(f'{release.digest(data)}  {name}\n')
        with self.assertRaises(ValueError):
            self.check()

    def test_audited_source_and_evidence_changes_fail(self):
        (self.root / 'src/views/asset.js').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'audited evidence input changed'):
            self.stage()
        (self.root / 'NOTICE-EVIDENCE.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'NOTICE does not bind'):
            self.stage()

    def test_workflow_gated_upload_and_tag_only_publication(self):
        workflow = SCRIPT.parents[1] / '.github/workflows/release.yml'
        text = workflow.read_text()
        self.assertIn("vars.LICENSE_SHA256 != '' && vars.NOTICE_SHA256 != ''", text)
        self.assertIn("node-version: 24", text)
        self.assertIn("needs: candidate", text)
        self.assertIn('APPROVED_LICENSE_SHA256: ${{ vars.LICENSE_SHA256 }}', text)
        self.assertIn('APPROVED_NOTICE_SHA256: ${{ vars.NOTICE_SHA256 }}', text)
        upload = text[text.index('- uses: actions/upload-artifact@'):text.index('  publish:')]
        self.assertIn("vars.LICENSE_SHA256 != '' && vars.NOTICE_SHA256 != ''", upload)
        self.assertIn("  publish:\n    if: startsWith(github.ref, 'refs/tags/v')", text)
        self.assertNotIn('--clobber', text)
        self.assertNotIn('npm publish', text)
        import re
        self.assertEqual(len(re.findall(r'uses: actions/[a-z-]+@[0-9a-f]{40}', text)), 5)

    def test_missing_source_closure(self):
        (self.root / 'src/views/asset.js').unlink()
        with self.assertRaises(FileNotFoundError):
            self.stage()

    def test_github_api_fail_closed_and_existing_release(self):
        for code in (401, 403, 500):
            with patch.object(release.urllib.request, 'urlopen', side_effect=urllib.error.HTTPError('url', code, 'error', {}, None)):
                with self.assertRaises(urllib.error.HTTPError):
                    release.absent('owner/repo', 'v0.1.0', 'token')
        with patch.object(release.urllib.request, 'urlopen', side_effect=urllib.error.URLError('offline')):
            with self.assertRaises(urllib.error.URLError):
                release.absent('owner/repo', 'v0.1.0', 'token')
        with patch.object(release.urllib.request, 'urlopen'):
            with self.assertRaises(ValueError):
                release.absent('owner/repo', 'v0.1.0', 'token')
        with patch.object(release.urllib.request, 'urlopen', side_effect=urllib.error.HTTPError('url', 404, 'missing', {}, None)):
            release.absent('owner/repo', 'v0.1.0', 'token')

    def test_branch_head_mismatch_and_api_error(self):
        with patch.object(release.subprocess, 'run'), patch.object(release.subprocess, 'check_output', side_effect=[b'a', b'b', b'a']), patch.dict(os.environ, {'GITHUB_SHA': 'a'}):
            with self.assertRaises(ValueError):
                release.branch('v0.1.0')
        with patch.object(release.subprocess, 'run', side_effect=RuntimeError('fetch failed')):
            with self.assertRaises(RuntimeError):
                release.branch('v0.1.0')


if __name__ == '__main__':
    unittest.main()
