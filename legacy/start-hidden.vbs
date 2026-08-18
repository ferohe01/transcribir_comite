Set WshShell = CreateObject("WScript.Shell")
' Obtener la ruta del directorio donde está este script
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Verificar si existe el archivo .exe
exePath = strPath & "\convierte_audio_texto.exe"
Set fso = CreateObject("Scripting.FileSystemObject")

If fso.FileExists(exePath) Then
    ' Ejecutar el .exe sin mostrar ventana (0 = oculto, False = no esperar)
    WshShell.Run Chr(34) & exePath & Chr(34), 0, False
Else
    ' Si no existe el .exe, intentar con node
    nodePath = strPath & "\server.js"
    If fso.FileExists(nodePath) Then
        WshShell.Run "cmd /c cd /d """ & strPath & """ && node server.js", 0, False
    Else
        MsgBox "No se encontró el archivo ejecutable ni server.js", vbCritical, "Error"
    End If
End If
