const REQUIRED_AZURE_SIGNING_ENV = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TRUSTED_SIGNING_ENDPOINT',
  'AZURE_TRUSTED_SIGNING_ACCOUNT',
  'AZURE_TRUSTED_SIGNING_PROFILE',
  'AZURE_TRUSTED_SIGNING_PUBLISHER',
];

function resolveAzureSigningConfig(env = process.env) {
  const values = Object.fromEntries(REQUIRED_AZURE_SIGNING_ENV.map((key) => [key, String(env[key] || '').trim()]));
  const required = String(env.XUANNIAN_REQUIRE_WINDOWS_SIGNING || '') === '1';
  const configured = REQUIRED_AZURE_SIGNING_ENV.some((key) => values[key]);
  const missing = REQUIRED_AZURE_SIGNING_ENV.filter((key) => !values[key]);
  if ((required || configured) && missing.length) {
    throw new Error(`Azure Artifact Signing configuration is incomplete. Missing: ${missing.join(', ')}`);
  }
  if (!configured) return { enabled: false, required, args: [] };
  return {
    enabled: true,
    required,
    args: [
      `--config.win.azureSignOptions.endpoint=${values.AZURE_TRUSTED_SIGNING_ENDPOINT}`,
      `--config.win.azureSignOptions.certificateProfileName=${values.AZURE_TRUSTED_SIGNING_PROFILE}`,
      `--config.win.azureSignOptions.codeSigningAccountName=${values.AZURE_TRUSTED_SIGNING_ACCOUNT}`,
      `--config.win.azureSignOptions.publisherName=${values.AZURE_TRUSTED_SIGNING_PUBLISHER}`,
      '--config.win.azureSignOptions.fileDigest=SHA256',
      '--config.win.azureSignOptions.timestampDigest=SHA256',
      '--config.forceCodeSigning=true',
    ],
  };
}

module.exports = {
  REQUIRED_AZURE_SIGNING_ENV,
  resolveAzureSigningConfig,
};
