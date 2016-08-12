@echo off
@cls

@set /p host="Enter host (default: "127.0.0.1"): "
@if "%host%"=="" set host=127.0.0.1

@set /p port="Enter port (default: 25575): "
@if "%port%"=="" set port=25575

@set /p passwd="Enter password: "
@if "%passwd%"=="" set passwd=

set name=connect_%host%-%port%

@set /p name="Enter shortcut name (default: "%name%.bat"): "
@if "%name%"=="" set name=connect_%host%-%port%

set command=@mcrcon.exe -t -H %host% -P %port% -p %passwd%

@echo %command% >> %name%.bat
@echo.
@echo Command: "%command%"
@echo.
@echo Shortcut "%name%.bat" created!
@echo.

@set "host="
@set "port="
@set "passwd="

@pause
