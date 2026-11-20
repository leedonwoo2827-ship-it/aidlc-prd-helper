"""Package only the reviewed source allowlist; never package local customer configuration."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.local/handoff/prd-cde.zip')
    args = parser.parse_args()
    output = args.output.resolve()
    manifest = json.loads((ROOT / 'handoff-files.json').read_text())
    # Verify path confinement and reject symlinks before copying.
    subprocess.run(['node', 'scripts/verify-handoff.mjs'], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory(prefix='prd-cde-export-') as temporary:
        stage = Path(temporary) / 'prd-cde'
        stage.mkdir()
        for name in manifest['files']:
            dest = stage / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, dest)
        subprocess.run(['node', str(stage / 'scripts/verify-handoff.mjs'), '--strict'], cwd=stage, check=True)
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(manifest['files']):
                archive.write(stage / name, 'prd-cde/' + name)
        with zipfile.ZipFile(output) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('ZIP integrity check failed.')
            if len(archive.namelist()) != len(manifest['files']):
                raise RuntimeError('Unexpected archive entries.')
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{checksum}  {output.name}\n')
    print(f'Created {output.name}: {len(manifest["files"])} files, ZIP integrity verified.')


if __name__ == '__main__':
    main()
