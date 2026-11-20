import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminGetUserCommand, AdminDisableUserCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { ROOT, loadDeployment, verifyTarget, awsEnvironment } from './deployment-config.mjs';
const args = process.argv.slice(2);
const action = args.shift();
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const username = option('--username');
if (!['create', 'close'].includes(action) || !/^[a-z0-9-]{3,50}$/.test(username || ''))
  throw new Error('Usage: node scripts/workshop-account.mjs create|close --username workshop-YYYYMMDD [--end ISO_TIMESTAMP] [--start ISO_TIMESTAMP] [--password-from PRIVATE_ACCOUNT_JSON]');
const config = loadDeployment(option('--config'));
verifyTarget(config);
Object.assign(process.env, awsEnvironment(config));
const region = config.region;
const stacks = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: config.stackName }));
const outputs = Object.fromEntries(stacks.Stacks[0].Outputs.map(x => [x.OutputKey, x.OutputValue]));
const cognito = new CognitoIdentityProviderClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const scheduler = new SchedulerClient({ region });
const scheduleName = `prd-${createHash('sha256').update(config.stackName).digest('hex').slice(0, 8)}-${username}`;
const pool = outputs.UserPoolId;
if (action === 'create') {
  const startsAt = option('--start') ? Date.parse(option('--start')) : Date.now() - 60000;
  const endsAt = Date.parse(option('--end'));
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= Date.now() || endsAt <= startsAt || endsAt - startsAt > 3 * 86400000)
    throw new Error('Give an explicit future --end with a UTC offset. Each workshop account is limited to 72 hours.');
  const passwordSource = option('--password-from');
  const password = passwordSource
    ? JSON.parse(await readFile(passwordSource, 'utf8')).password
    : `Aa1!${randomBytes(20).toString('base64url')}`;
  if (typeof password !== 'string' || password.length < 14)
    throw new Error('The private account file must contain a valid password of at least 14 characters.');
  let created = false, sub;
  try {
    const result = await cognito.send(new AdminCreateUserCommand({ UserPoolId: pool, Username: username, MessageAction: 'SUPPRESS', TemporaryPassword: password }));
    created = true;
    sub = result.User.Attributes.find(a => a.Name === 'sub').Value;
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: pool, Username: username, Password: password, Permanent: true }));
    await ddb.send(new PutCommand({ TableName: outputs.TableName, Item: {
      pk: `WORKSHOP#${sub}`, username, enabled: true, startsAt, endsAt, modelCalls: 0,
      maxModelCalls: 2000, scheduleName, expiresAt: Math.floor(endsAt / 1000) + 86400
    }, ConditionExpression: 'attribute_not_exists(pk)' }));
    await scheduler.send(new CreateScheduleCommand({
      Name: scheduleName, ScheduleExpression: `at(${new Date(endsAt).toISOString().slice(0, 19)})`,
      ScheduleExpressionTimezone: 'UTC', FlexibleTimeWindow: { Mode: 'OFF' }, ActionAfterCompletion: 'DELETE',
      Target: { Arn: outputs.FunctionArn, RoleArn: outputs.ExpiryRoleArn,
        Input: JSON.stringify({ source: 'workshop-expiry', username, sub }),
        RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 3 }
      }
    }));
    const directory = path.join(ROOT, '.local/accounts');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${username}.json`);
    await writeFile(file, JSON.stringify({
      username, password, siteUrl: outputs.SiteUrl, endsAt: new Date(endsAt).toISOString(),
      endsAtKst: new Date(endsAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      userPoolId: pool, clientId: outputs.ClientId, region, sub, note: '워크숍 기간에만 쓰는 공유 계정. 외부 저장소나 대화 기록에 비밀번호를 복사하지 마세요.'
    }, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ created: true, username, endsAt: new Date(endsAt).toISOString(), credentialsFile: file }));
  } catch (error) {
    if (sub) await ddb.send(new UpdateCommand({ TableName: outputs.TableName, Key: { pk: `WORKSHOP#${sub}` }, UpdateExpression: 'SET enabled = :no', ExpressionAttributeValues: { ':no': false } })).catch(() => {});
    if (created) await cognito.send(new AdminDisableUserCommand({ UserPoolId: pool, Username: username })).catch(() => {});
    throw error;
  }
} else {
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: pool, Username: username }));
  const sub = user.UserAttributes.find(a => a.Name === 'sub').Value;
  const record = (await ddb.send(new GetCommand({ TableName: outputs.TableName, Key: { pk: `WORKSHOP#${sub}` }, ConsistentRead: true }))).Item;
  await ddb.send(new UpdateCommand({ TableName: outputs.TableName, Key: { pk: `WORKSHOP#${sub}` }, UpdateExpression: 'SET enabled = :no', ExpressionAttributeValues: { ':no': false } }));
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: pool, Username: username }));
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: pool, Username: username }));
  if (record?.scheduleName) await scheduler.send(new DeleteScheduleCommand({ Name: record.scheduleName })).catch(e => { if (e.name !== 'ResourceNotFoundException') throw e; });
  console.log(JSON.stringify({ closed: true, deleted: true, username }));
}
