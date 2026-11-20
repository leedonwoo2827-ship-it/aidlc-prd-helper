"""Recreate the helper in the customer's AWS account. Default: offline plan only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def read_config(file):
    result = subprocess.run(
        ['node', 'scripts/deployment-config.mjs', str(file)],
        cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr.strip())
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT / 'config/deployment.json')
    parser.add_argument('--apply', action='store_true', help='Create AWS resources and publish the helper.')
    parser.add_argument('--update-existing', action='store_true', help='Allow changes to an existing customer stack.')
    args = parser.parse_args()
    config = read_config(args.config.resolve())
    if not args.apply:
        print('Configuration is valid. Offline plan only; AWS was not contacted.')
        print('Apply: verify AWS account, create private origins/Cognito/store, verify anonymous denial, upload API and public login assets.')
        print('Use --apply to provision; add --update-existing only for a customer stack you intend to update.')
        return
    env = {**os.environ, 'AWS_REGION': config['region'], 'AWS_DEFAULT_REGION': config['region']}
    if config['awsProfile']:
        env['AWS_PROFILE'] = config['awsProfile']

    def aws(*command, parsed=True):
        command = ['aws', *command, '--region', config['region']]
        if parsed:
            command += ['--output', 'json']
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or 'AWS CLI failed.')
        return json.loads(result.stdout) if parsed else result.stdout

    if aws('sts', 'get-caller-identity')['Account'] != config['expectedAccountId']:
        raise ValueError('AWS account does not match expectedAccountId. No resources were changed.')

    def outputs():
        stack = aws('cloudformation', 'describe-stacks', '--stack-name', config['stackName'])['Stacks'][0]
        return {v['OutputKey']: v['OutputValue'] for v in stack['Outputs']}

    origin = ''
    try:
        origin = outputs()['SiteUrl']
    except RuntimeError as error:
        if 'does not exist' not in str(error):
            raise
    if origin and not args.update_existing:
        raise ValueError('Stack already exists. Review the target and use --update-existing explicitly.')

    subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=ROOT, check=True)
    subprocess.run(['npm', 'run', 'check'], cwd=ROOT, check=True)
    subprocess.run(['npm', 'test'], cwd=ROOT, check=True)
    out = ROOT / '.local/deploy'
    out.mkdir(parents=True, exist_ok=True, mode=0o700)

    def infrastructure(web_origin):
        aws('cloudformation', 'deploy', '--stack-name', config['stackName'],
            '--template-file', 'infra/template.yaml', '--capabilities', 'CAPABILITY_IAM',
            '--parameter-overrides', 'WebOrigin=' + web_origin,
            'ModelId=' + config['modelId'], 'BedrockResourceArns=' + ','.join(config['bedrockResourceArns']),
            '--no-fail-on-empty-changeset', parsed=False)

    def assert_denial(site_url):
        try:
            with urllib.request.urlopen(site_url + '/api/me', timeout=30):
                raise RuntimeError('API admitted an anonymous request. Upload stopped.')
        except urllib.error.HTTPError as error:
            data = json.loads(error.read())
            if error.code != 401 or data.get('error', {}).get('code') != 'LOGIN_REQUIRED' or 'Bearer' not in error.headers.get('WWW-Authenticate', ''):
                raise RuntimeError('Expected a denial from the Cognito login gate. Upload stopped.') from None

    print('Creating/updating private origins, Cognito and the conversation store.', flush=True)
    infrastructure(origin)
    values = outputs()
    if not origin:
        infrastructure(values['SiteUrl'])
        values = outputs()
    aws('cloudfront', 'wait', 'distribution-deployed', '--id', values['DistributionId'], parsed=False)
    # The bootstrap function denies every request, before application code is uploaded.
    assert_denial(values['SiteUrl'])
    archive = out / 'lambda.zip'
    files = [ROOT / p for p in ['index.mjs', 'package.json', 'public/shared.js', 'public/workshop.js']]
    files += list((ROOT / 'server').rglob('*')) + list((ROOT / 'node_modules').rglob('*'))
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for file in files:
            if file.is_file() and not file.is_symlink():
                z.write(file, file.relative_to(ROOT).as_posix())
    aws('lambda', 'update-function-code', '--function-name', values['FunctionName'], '--zip-file', 'fileb://' + str(archive))
    aws('lambda', 'wait', 'function-updated-v2', '--function-name', values['FunctionName'], parsed=False)
    assert_denial(values['SiteUrl'])
    print('Anonymous denial verified. Uploading public login/application assets.', flush=True)
    aws('s3', 'sync', 'public/', 's3://' + values['BucketName'] + '/', '--cache-control', 'no-cache', '--only-show-errors', parsed=False)
    invalidation = aws('cloudfront', 'create-invalidation', '--distribution-id', values['DistributionId'], '--paths', '/*')
    aws('cloudfront', 'wait', 'invalidation-completed', '--distribution-id', values['DistributionId'],
        '--id', invalidation['Invalidation']['Id'], parsed=False)
    report = out / 'release.json'
    with open(report, 'w', encoding='utf-8', opener=lambda p, f: os.open(p, f, 0o600)) as f:
        json.dump({**values, 'lambdaZipSha256': hashlib.sha256(archive.read_bytes()).hexdigest()}, f, indent=2)
    print('Deployment written to .local/deploy/release.json. Run customer-account acceptance checks next.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from None
