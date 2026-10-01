#!/usr/bin/env python3
"""Stdlib-only deterministic Project Unit staging and independent verification."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import urllib.error
import urllib.request
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def approved(root):
    for name in ('LICENSE', 'NOTICE'):
        expected = os.environ['APPROVED_' + name + '_SHA256']
        if not re.fullmatch('[0-9a-f]{64}', expected) or digest((root / name).read_bytes()) != expected:
            raise ValueError(f'{name} owner-approved digest missing or mismatched')
    if 'PROVENANCE_PENDING' in (root / 'NOTICE').read_text():
        raise ValueError('theme provenance audit pending')


def payload(root, tag):
    root = root.resolve()
    package = json.loads((root / 'package.json').read_text())
    config = json.loads((root / 'release.json').read_text())
    if not re.fullmatch(r'(view|ui-service|theme)\.[a-z0-9-]+', package['name']):
        raise ValueError('invalid Project Unit identity')
    if 'GITHUB_REPOSITORY' in os.environ and os.environ['GITHUB_REPOSITORY'] != 'kkgams/' + package['name']:
        raise ValueError('workflow repository must match canonical Project Unit identity')
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', package['version']) or tag != 'v' + package['version']:
        raise ValueError('tag/version mismatch')
    if package['license'] != 'Apache-2.0' or package['private'] is not True:
        raise ValueError('invalid package licensing/publication policy')
    approved(root)
    evidence_bytes = (root / 'NOTICE-EVIDENCE.json').read_bytes()
    if ('NOTICE-EVIDENCE.json SHA-256: ' + digest(evidence_bytes)) not in (root / 'NOTICE').read_text():
        raise ValueError('NOTICE does not bind current evidence')
    evidence = json.loads(evidence_bytes)
    for path, expected in evidence['files_sha256'].items():
        local = root / path
        if not local.resolve().is_relative_to(root) or local.is_symlink() or digest(local.read_bytes()) != expected:
            raise ValueError('audited evidence input changed: ' + path)
    files = {}
    mapping = {}
    source_files = package['files']
    if not source_files or len(source_files) != len(set(source_files)):
        raise ValueError('empty or duplicate source mapping')
    actual = {p.relative_to(root).as_posix() for p in (root / 'src').rglob('*') if p.is_file()}
    if actual != set(source_files):
        raise ValueError('source closure differs from package files')
    if actual != {p for p in evidence['files_sha256'] if p.startswith('src/')}:
        raise ValueError('source closure differs from audited evidence')
    for source in source_files:
        path = PurePosixPath(source)
        if path.parts[0] != 'src' or '..' in path.parts or str(path) != source:
            raise ValueError('invalid source path')
        local = root / source
        if any(p.is_symlink() for p in [local, *[p for p in local.parents if p.is_relative_to(root)]]):
            raise ValueError('symlink source forbidden')
        deployed = path.relative_to('src').as_posix()
        if deployed in files or deployed in ('LICENSE', 'NOTICE', 'README.md', 'unit.json'):
            raise ValueError('duplicate deployment output')
        files[deployed] = local.read_bytes()
        mapping[deployed] = digest(files[deployed])
    if config['entry'] not in files:
        raise ValueError('missing deployed entry')
    for name in ('LICENSE', 'NOTICE', 'README.md'):
        files[name] = (root / name).read_bytes()
    unit = dict(name=package['name'], kind=config['kind'], version=package['version'],
                entry=config['entry'], files=mapping,
                host={'target': '2.0.3',
                      'note': 'Host source contract targeted; package-level GUI validation remains a release gate.'})
    files['unit.json'] = (json.dumps(unit, indent=2, sort_keys=True) + '\n').encode()
    return package['name'] + '-' + package['version'] + '.zip', files


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
    return output.getvalue()


def stage(root, out, tag):
    name, files = payload(root, tag)
    data = archive(files)
    out.mkdir(parents=True, exist_ok=False)
    (out / name).write_bytes(data)
    (out / 'SHA256SUMS').write_text(f'{digest(data)}  {name}\n')


def check(root, out, tag):
    name, files = payload(root, tag)
    if {p.name for p in out.iterdir()} != {name, 'SHA256SUMS'}:
        raise ValueError('missing or extra candidate inputs; no source fallback')
    data = (out / name).read_bytes()
    if (out / 'SHA256SUMS').read_text() != f'{digest(data)}  {name}\n':
        raise ValueError('checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if len(z.namelist()) != len(files) or set(z.namelist()) != set(files):
            raise ValueError('duplicate/missing/extra ZIP entries')
        for path, expected in files.items():
            if z.read(path) != expected:
                raise ValueError(f'candidate content mismatch: {path}')
    if data != archive(files):
        raise ValueError('non-deterministic candidate metadata')


def branch(tag):
    package = json.loads((Path(__file__).resolve().parents[1] / 'package.json').read_text())
    if tag != 'v' + package['version']:
        raise ValueError('tag/version mismatch')
    subprocess.run(['git', 'fetch', '--no-tags', 'origin', 'refs/heads/release'], check=True)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD']).strip()
    release = subprocess.check_output(['git', 'rev-parse', 'FETCH_HEAD']).strip()
    tagged = subprocess.check_output(['git', 'rev-parse', tag + '^{commit}']).strip()
    if head != release or head != tagged or head.decode() != os.environ['GITHUB_SHA']:
        raise ValueError('tag must match current release branch HEAD and workflow SHA')


def absent(repository, tag, token):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository) or not re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', tag):
        raise ValueError('invalid release identity')
    request = urllib.request.Request(
        f'https://api.github.com/repos/{repository}/releases/tags/{tag}',
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
    try:
        with urllib.request.urlopen(request, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        error.close()
        if error.code == 404:
            return
        raise
    raise ValueError('immutable release already exists; refusing overwrite')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['stage', 'check', 'branch', 'absent'])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--out', type=Path, default=Path('dist/candidate'))
    parser.add_argument('--tag', required=True)
    args = parser.parse_args()
    if args.command in ('stage', 'check'):
        globals()[args.command](args.root.resolve(), args.out, args.tag)
    elif args.command == 'branch':
        branch(args.tag)
    else:
        absent(os.environ['GITHUB_REPOSITORY'], args.tag, os.environ['GH_TOKEN'])
