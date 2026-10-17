' APOLOGEA Studio - Start ohne Konsolenfenster
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(base & "\runtime\node.exe") Then
  node = base & "\runtime\node.exe"
  app = base & "\app\launcher.js"
Else
  node = "node.exe"
  app = base & "\launcher.js"
End If
Set sh = CreateObject("WScript.Shell")
sh.Run """" & node & """ """ & app & """", 0, False
