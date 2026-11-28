!macro VC_REQUIRE_APP_CLOSED
  StrCpy $5 0
  StrCpy $6 0
  ${GetOptions} $CMDLINE "/UPDATE" $4
  ${IfNot} ${Errors}
    ; The in-app updater launches setup before exiting its own process.
    StrCpy $6 80
  ${EndIf}
  ${Do}
    nsis_tauri_utils::FindProcessCurrentUser "${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 != 0
    ${OrIf} $5 >= $6
      ${ExitDo}
    ${EndIf}
    Sleep 250
    IntOp $5 $5 + 1
  ${Loop}
  ${If} $0 = 0
    IfSilent +2
    MessageBox MB_ICONEXCLAMATION|MB_OK "Close ${PRODUCTNAME} before installing the update."
    SetErrorLevel 4
    Quit
  ${EndIf}
!macroend

!macro VC_REFRESH_SHELL_ICON ItemPath
  ; SHCNE_UPDATEITEM, with a Unicode path and asynchronous delivery.
  System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x00002005, w "${ItemPath}", p 0)'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro VC_REFRESH_SHELL_ICON "$INSTDIR\${MAINBINARYNAME}.exe"
  !if "${STARTMENUFOLDER}" != ""
    IfFileExists "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" 0 +2
      !insertmacro VC_REFRESH_SHELL_ICON "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 +2
      !insertmacro VC_REFRESH_SHELL_ICON "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +2
    !insertmacro VC_REFRESH_SHELL_ICON "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend

!macro VC_AUTOMATIC_UPGRADE
  ReadRegStr $1 SHCTX "${MANUPRODUCTKEY}" ""
  ReadRegStr $2 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ReadRegStr $3 SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $1 != ""
  ${AndIf} $2 != ""
  ${AndIf} $3 == "${MAINBINARYNAME}.exe"
  ${AndIf} ${FileExists} "$1\${MAINBINARYNAME}.exe"
  ${AndIf} ${FileExists} "$1\uninstall.exe"
    nsis_tauri_utils::SemverCompare "${VERSION}" "$2"
    Pop $0
    ${If} $0 = 1
      StrCpy $INSTDIR $1
      StrCpy $PassiveMode 1
      StrCpy $UpdateMode 1
      !insertmacro VC_REQUIRE_APP_CLOSED
    ${EndIf}
  ${EndIf}
!macroend
