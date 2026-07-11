!ifndef BUILD_UNINSTALLER
Var XuanNianUpgradeBackup
Var XuanNianUpgradeStoragePath

!macro BackupXuanNianData SOURCE_DIR BACKUP_DIR TAG
  IfFileExists "${SOURCE_DIR}\xuannian-data.json" 0 backup_done_${TAG}
  CreateDirectory "${BACKUP_DIR}"
  CopyFiles /SILENT "${SOURCE_DIR}\xuannian-data.json" "${BACKUP_DIR}"

  IfFileExists "${SOURCE_DIR}\xuannian-assets\*.*" 0 +3
  CreateDirectory "${BACKUP_DIR}\xuannian-assets"
  CopyFiles /SILENT "${SOURCE_DIR}\xuannian-assets\*.*" "${BACKUP_DIR}\xuannian-assets"

  IfFileExists "${SOURCE_DIR}\clipboard-images\*.*" 0 +3
  CreateDirectory "${BACKUP_DIR}\clipboard-images"
  CopyFiles /SILENT "${SOURCE_DIR}\clipboard-images\*.*" "${BACKUP_DIR}\clipboard-images"

  IfFileExists "${SOURCE_DIR}\screenshots\*.*" 0 backup_done_${TAG}
  CreateDirectory "${BACKUP_DIR}\screenshots"
  CopyFiles /SILENT "${SOURCE_DIR}\screenshots\*.*" "${BACKUP_DIR}\screenshots"
  backup_done_${TAG}:
!macroend

!macro RestoreXuanNianData BACKUP_DIR TARGET_DIR TAG
  IfFileExists "${BACKUP_DIR}\xuannian-data.json" 0 restore_done_${TAG}
  CreateDirectory "${TARGET_DIR}"
  CopyFiles /SILENT "${BACKUP_DIR}\xuannian-data.json" "${TARGET_DIR}"

  IfFileExists "${BACKUP_DIR}\xuannian-assets\*.*" 0 +3
  CreateDirectory "${TARGET_DIR}\xuannian-assets"
  CopyFiles /SILENT "${BACKUP_DIR}\xuannian-assets\*.*" "${TARGET_DIR}\xuannian-assets"

  IfFileExists "${BACKUP_DIR}\clipboard-images\*.*" 0 +3
  CreateDirectory "${TARGET_DIR}\clipboard-images"
  CopyFiles /SILENT "${BACKUP_DIR}\clipboard-images\*.*" "${TARGET_DIR}\clipboard-images"

  IfFileExists "${BACKUP_DIR}\screenshots\*.*" 0 restore_done_${TAG}
  CreateDirectory "${TARGET_DIR}\screenshots"
  CopyFiles /SILENT "${BACKUP_DIR}\screenshots\*.*" "${TARGET_DIR}\screenshots"
  restore_done_${TAG}:
!macroend

!macro customInit
  InitPluginsDir
  StrCpy $XuanNianUpgradeBackup "$PLUGINSDIR\xuannian-upgrade-backup"
  !insertmacro BackupXuanNianData "$APPDATA\玄念" "$XuanNianUpgradeBackup\stable" STABLE
  !insertmacro BackupXuanNianData "$APPDATA\xuannian" "$XuanNianUpgradeBackup\legacy" LEGACY

  ReadRegStr $XuanNianUpgradeStoragePath HKCU "Software\XuanNian2.0" "StoragePath"
  ${If} $XuanNianUpgradeStoragePath != ""
  ${AndIf} $XuanNianUpgradeStoragePath != "$APPDATA\玄念"
  ${AndIf} $XuanNianUpgradeStoragePath != "$APPDATA\xuannian"
    !insertmacro BackupXuanNianData "$XuanNianUpgradeStoragePath" "$XuanNianUpgradeBackup\custom" CUSTOM
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro RestoreXuanNianData "$XuanNianUpgradeBackup\stable" "$APPDATA\玄念" STABLE
  !insertmacro RestoreXuanNianData "$XuanNianUpgradeBackup\legacy" "$APPDATA\xuannian" LEGACY
  ${If} $XuanNianUpgradeStoragePath != ""
  ${AndIf} $XuanNianUpgradeStoragePath != "$APPDATA\玄念"
  ${AndIf} $XuanNianUpgradeStoragePath != "$APPDATA\xuannian"
    !insertmacro RestoreXuanNianData "$XuanNianUpgradeBackup\custom" "$XuanNianUpgradeStoragePath" CUSTOM
  ${EndIf}

  Delete "$DESKTOP\玄念6.0.lnk"
  Delete "$DESKTOP\玄念6.0.1.lnk"
  Delete "$DESKTOP\玄念6.0.2.lnk"
  Delete "$DESKTOP\XuanNian 6.0.lnk"
  Delete "$DESKTOP\XuanNian 6.0.1.lnk"
  Delete "$DESKTOP\XuanNian 6.0.2.lnk"
  Delete "$SMPROGRAMS\玄念6.0.lnk"
  Delete "$SMPROGRAMS\玄念6.0.1.lnk"
  Delete "$SMPROGRAMS\玄念6.0.2.lnk"
  Delete "$SMPROGRAMS\XuanNian 6.0.lnk"
  Delete "$SMPROGRAMS\XuanNian 6.0.1.lnk"
  Delete "$SMPROGRAMS\XuanNian 6.0.2.lnk"
  RMDir "$SMPROGRAMS\玄念6.0"
  RMDir "$SMPROGRAMS\玄念6.0.1"
  RMDir "$SMPROGRAMS\玄念6.0.2"
!macroend
!endif

!macro customUnInstall
  DetailPrint "玄念卸载默认保留收藏文档、提示词、便签、灵感和附件。"
!macroend

!macro customUnInstallSection
  Section /o "删除收藏文档、提示词、便签、灵感和附件（默认不勾选）" SecDeleteXuanNianData
    ${If} ${isUpdated}
      Goto deleteDataDone
    ${EndIf}

    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "确定要删除玄念收藏文档、提示词、便签、灵感、剪切板记录和转存附件吗？$\r$\n$\r$\n此操作不可恢复。默认建议不要删除。" /SD IDNO IDNO deleteDataDone

    ReadRegStr $0 HKCU "Software\XuanNian2.0" "StoragePath"
    RMDir /r "$APPDATA\玄念"
    RMDir /r "$APPDATA\xuannian"

    ${If} $0 != ""
    ${AndIf} $0 != "$APPDATA\玄念"
    ${AndIf} $0 != "$APPDATA\xuannian"
      Delete "$0\xuannian-data.json"
      RMDir /r "$0\xuannian-assets"
      RMDir /r "$0\clipboard-images"
      RMDir /r "$0\screenshots"
      RMDir "$0"
    ${EndIf}

    DeleteRegKey HKCU "Software\XuanNian2.0"

    deleteDataDone:
  SectionEnd
!macroend
