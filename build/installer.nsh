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
  !insertmacro BackupXuanNianData "$APPDATA\xuannian" "$XuanNianUpgradeBackup\default" DEFAULT

  ReadRegStr $XuanNianUpgradeStoragePath HKCU "Software\XuanNian2.0" "StoragePath"
  ${If} $XuanNianUpgradeStoragePath != ""
  ${AndIf} $XuanNianUpgradeStoragePath != "$APPDATA\xuannian"
    !insertmacro BackupXuanNianData "$XuanNianUpgradeStoragePath" "$XuanNianUpgradeBackup\custom" CUSTOM
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro RestoreXuanNianData "$XuanNianUpgradeBackup\default" "$APPDATA\xuannian" DEFAULT
  ${If} $XuanNianUpgradeStoragePath != ""
  ${AndIf} $XuanNianUpgradeStoragePath != "$APPDATA\xuannian"
    !insertmacro RestoreXuanNianData "$XuanNianUpgradeBackup\custom" "$XuanNianUpgradeStoragePath" CUSTOM
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  ${If} ${isUpdated}
    Goto keepData
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除玄念运行产生的数据、灵感、便签、快捷指令及转存附件？$\r$\n$\r$\n默认选择“否”，保留数据便于以后重新安装继续使用。" /SD IDNO IDNO keepData

  ReadRegStr $0 HKCU "Software\XuanNian2.0" "StoragePath"
  RMDir /r "$APPDATA\xuannian"

  ${If} $0 != ""
    Delete "$0\xuannian-data.json"
    RMDir /r "$0\xuannian-assets"
    RMDir "$0"
  ${EndIf}

  DeleteRegKey HKCU "Software\XuanNian2.0"
  Goto dataChoiceDone

  keepData:
  DeleteRegKey HKCU "Software\XuanNian2.0"

  dataChoiceDone:
!macroend
