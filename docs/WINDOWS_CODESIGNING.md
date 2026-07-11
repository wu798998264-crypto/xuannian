# Windows Code Signing and SmartScreen

Windows Defender SmartScreen may show a blue warning window for new or unsigned `.exe` files. This is controlled by Microsoft's reputation system and cannot be fully removed by changing application code alone.

## What reduces the warning

- Sign every Windows release with the same trusted OV or EV code signing certificate.
- Keep the publisher identity stable across versions.
- Distribute releases from a consistent public download location.
- Submit false positives or suspicious detections to Microsoft Security Intelligence for review.
- For the strongest distribution trust, publish through Microsoft Store.

Self-signed certificates do not solve SmartScreen reputation for end users.

## GitHub Actions secrets

The Windows workflow supports certificate signing when these repository secrets are configured:

- `WINDOWS_CSC_LINK`: base64 encoded `.pfx` certificate content, or a secure URL supported by electron-builder.
- `WINDOWS_CSC_KEY_PASSWORD`: password for the `.pfx` certificate.

After these secrets are set, rerun the Windows packaging workflow and verify the result:

```powershell
Get-AuthenticodeSignature .\XuanNian-6.0.1-Setup.exe
```

Expected result after real signing:

```text
Status        : Valid
SignatureType : Authenticode
```

If the result is `NotSigned`, SmartScreen warnings are still likely on some PCs.

## Microsoft submission

If a signed release is still blocked, submit the released installer to Microsoft:

https://www.microsoft.com/en-us/wdsi/filesubmission
