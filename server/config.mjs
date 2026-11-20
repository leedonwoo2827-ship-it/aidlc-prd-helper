// Configuration errors must happen before constructing an AWS client.
export function required(env, names) {
  const missing = names.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) throw new Error(`Required configuration is empty: ${missing.join(', ')}`);
}

export function localConfig(env = process.env) {
  const provider = env.COACH_PROVIDER?.trim() || 'bedrock';
  if (!['bedrock', 'claude', 'codex'].includes(provider)) throw new Error('COACH_PROVIDER must be claude, codex or bedrock.');
  if (provider !== 'bedrock') {
    const port = Number(env.PORT || 4319);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
    return { provider, bedrockEnabled: true, port, region: '', modelId: env.COACH_MODEL?.trim() || '', modelLabel: '' };
  }
  const enabled = env.BEDROCK_ENABLED?.trim() || 'false';
  if (!['true', 'false'].includes(enabled)) throw new Error('BEDROCK_ENABLED must be true or false.');
  const bedrockEnabled = enabled === 'true';
  if (bedrockEnabled) required(env, ['AWS_REGION', 'BEDROCK_MODEL_ID']);
  const port = Number(env.PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  return {
    provider, bedrockEnabled, port, region: env.AWS_REGION?.trim() || '',
    modelId: env.BEDROCK_MODEL_ID?.trim() || '',
    modelLabel: env.BEDROCK_MODEL_LABEL?.trim() || 'Bedrock'
  };
}

export function cloudConfig(env = process.env) {
  required(env, ['AWS_REGION', 'BEDROCK_MODEL_ID', 'USER_POOL_ID', 'CLIENT_ID', 'TABLE_NAME', 'PUBLIC_ORIGIN']);
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.PUBLIC_ORIGIN)
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  return { modelLabel: env.BEDROCK_MODEL_LABEL?.trim() || 'Bedrock' };
}
