!define SPINEPET_TASKBAR_APP_ID "local.spine.desktop.pet.workshop.SpinePet"

; Keep the installation GUID and update identity unchanged. Only the Windows
; taskbar identity moves away from the legacy Electron/development association.
!macro customInstall
  ${If} ${FileExists} "$newStartMenuLink"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${SPINEPET_TASKBAR_APP_ID}"
  ${EndIf}
  ${If} ${FileExists} "$newDesktopLink"
    WinShell::SetLnkAUMI "$newDesktopLink" "${SPINEPET_TASKBAR_APP_ID}"
  ${EndIf}
!macroend
