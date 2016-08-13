start nodemon client.js
start nodemon master.js

cd "Factorio 0.13.9 - Copy/bin/x64"
start factorio.exe
cd ..
cd ..
cd ..

cd "Factorio 0.13.9"
@RD /S /Q "temp"
cd "bin/x64"
start factorio.exe --start-server-load-latest --rcon-port 12345 --rcon-password 123 --server-settings server-settings.json --no-auto-pause
cd ..
cd ..
cd ..
@mcrcon.exe -t -H 81.167.2.56 -P 12345 -p 123

pause