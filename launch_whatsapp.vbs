Set fso = CreateObject("Scripting.FileSystemObject")
botDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = botDir
WshShell.Run "cmd.exe /c node src/index.js", 0, False
