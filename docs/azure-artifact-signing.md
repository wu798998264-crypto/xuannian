# Azure Artifact Signing release setup

Windows release builds are blocked unless Azure Artifact Signing is fully configured. Local builds remain available for development, but must not be published as production releases.

## Azure prerequisites

1. Complete Public Trust identity validation in an eligible country or region.
2. Create an Artifact Signing account and a Public Trust certificate profile.
3. Create a Microsoft Entra service principal.
4. Grant that service principal the `Artifact Signing Certificate Profile Signer` role on the certificate profile.

## GitHub Actions secrets

Configure these repository secrets:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT`
- `AZURE_TRUSTED_SIGNING_PROFILE`
- `AZURE_TRUSTED_SIGNING_PUBLISHER`

The release workflow passes only account metadata to electron-builder. Authentication values stay in GitHub Secrets. The workflow verifies every generated Windows executable with `Get-AuthenticodeSignature` and stops before publication when any signature is missing or invalid.

Do not commit credentials, client secrets, or exported certificates to this repository.
