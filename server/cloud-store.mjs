import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { AppError } from './engine.mjs';

export class CloudStore {
  constructor(table = process.env.TABLE_NAME, client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })) {
    this.table = table; this.client = client;
  }
  async get(pk) {
    return (await this.client.send(new GetCommand({ TableName: this.table, Key: { pk }, ConsistentRead: true }))).Item;
  }
  async create(item) {
    await this.client.send(new PutCommand({ TableName: this.table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  }
  async workshop(sub) {
    const item = await this.get(`WORKSHOP#${sub}`);
    if (!item || item.enabled !== true || item.endsAt <= Date.now())
      throw new AppError(403, 'WORKSHOP_EXPIRED', '이 워크숍 계정의 이용이 종료됐어요. 진행자에게 새 계정을 확인해 주세요.');
    if (item.startsAt > Date.now()) throw new AppError(403, 'WORKSHOP_NOT_STARTED', '아직 워크숍 이용 시간이 아니에요.');
    return item;
  }
  async spend(sub) {
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.table, Key: { pk: `WORKSHOP#${sub}` },
        UpdateExpression: 'ADD modelCalls :one',
        ConditionExpression: 'enabled = :enabled AND endsAt > :now AND (attribute_not_exists(modelCalls) OR modelCalls < maxModelCalls)',
        ExpressionAttributeValues: { ':one': 1, ':enabled': true, ':now': Date.now() }
      }));
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') throw new AppError(429, 'WORKSHOP_LIMIT', '워크숍 이용 시간이 끝났거나 AI 요청 한도에 도달했어요. 진행자에게 확인해 주세요.');
      throw e;
    }
  }
  async acquire(session, requestId, revision) {
    try {
      const now = Date.now();
      return (await this.client.send(new UpdateCommand({
        TableName: this.table, Key: { pk: session.pk },
        UpdateExpression: 'SET lockOwner = :owner, lockUntil = :until ADD attempts :one',
        ConditionExpression: 'revision = :revision AND expiresAt > :now AND attempts < :max AND (attribute_not_exists(lockOwner) OR lockUntil < :nowMs)',
        ExpressionAttributeValues: { ':owner': requestId, ':until': now + 70000, ':revision': revision, ':one': 1, ':max': 40, ':now': Math.floor(now / 1000), ':nowMs': now },
        ReturnValues: 'ALL_NEW'
      }))).Attributes;
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') throw new AppError(409, 'BUSY_OR_STALE', '이 대화의 요청이 처리 중이거나 상태가 변경됐어요. 잠시 후 다시 보내 주세요.');
      throw e;
    }
  }
  async commit(session, requestId, previousRevision) {
    const clean = { ...session };
    delete clean.lockOwner; delete clean.lockUntil;
    if (Buffer.byteLength(JSON.stringify(clean)) > 320000) throw new AppError(413, 'SESSION_TOO_LARGE', '대화가 길어졌어요. 현재 PRD를 내려받고 새 대화를 시작해 주세요.');
    try {
      await this.client.send(new PutCommand({
        TableName: this.table, Item: clean,
        ConditionExpression: 'lockOwner = :owner AND revision = :revision',
        ExpressionAttributeValues: { ':owner': requestId, ':revision': previousRevision }
      }));
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') throw new AppError(409, 'STALE_REVISION', '다른 요청으로 대화 상태가 변경됐어요. 내용을 확인하고 다시 보내 주세요.');
      throw e;
    }
  }
  async release(pk, requestId) {
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.table, Key: { pk }, UpdateExpression: 'REMOVE lockOwner, lockUntil',
        ConditionExpression: 'lockOwner = :owner', ExpressionAttributeValues: { ':owner': requestId }
      }));
    } catch (e) { if (e.name !== 'ConditionalCheckFailedException') throw e; }
  }
  async remove(session) {
    try {
      await this.client.send(new DeleteCommand({
        TableName: this.table, Key: { pk: session.pk },
        ConditionExpression: 'revision = :revision AND (attribute_not_exists(lockOwner) OR lockUntil < :now)',
        ExpressionAttributeValues: { ':revision': session.revision, ':now': Date.now() }
      }));
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') throw new AppError(409, 'BUSY', '응답이 끝난 후 대화를 종료해 주세요.');
      throw e;
    }
  }
}
