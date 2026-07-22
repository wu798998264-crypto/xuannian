const assert = require('assert');
const {
  REQUIRED_AZURE_SIGNING_ENV,
  resolveAzureSigningConfig,
} = require('../scripts/azure-signing-config');

const complete = Object.fromEntries(REQUIRED_AZURE_SIGNING_ENV.map((key) => [key, `value-${key}`]));
const enabled = resolveAzureSigningConfig(complete);
assert.strictEqual(enabled.enabled, true);
assert(enabled.args.some((value) => value.includes('azureSignOptions.endpoint')));
assert(enabled.args.includes('--config.forceCodeSigning=true'));
assert.deepStrictEqual(resolveAzureSigningConfig({}), { enabled: false, required: false, args: [] });
assert.throws(
  () => resolveAzureSigningConfig({ XUANNIAN_REQUIRE_WINDOWS_SIGNING: '1' }),
  /AZURE_TENANT_ID/,
);
assert.throws(
  () => resolveAzureSigningConfig({ AZURE_TENANT_ID: 'partial' }),
  /AZURE_CLIENT_ID/,
);

console.log('azure signing configuration tests passed');
