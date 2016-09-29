cd "Factorio_0.13.17"
@RD /S /Q "temp"
cd "bin/x64/"
start factorio.exe --start-server testmap.zip --rcon-port 12345 --rcon-password 123 --server-settings server-settings.json
pause