@echo off
chcp 65001 >nul
title Vistoria ECV
cd /d "%~dp0"

docker info >nul 2>&1
if not errorlevel 1 goto docker_ok
echo Abrindo o Docker Desktop...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
:esperar_docker
timeout /t 5 /nobreak >nul
docker info >nul 2>&1
if errorlevel 1 goto esperar_docker
:docker_ok

rem Abre (restaura do Drive se o outro computador salvou algo novo), liga o sistema e,
rem ao apertar Ctrl+C, salva no Drive e libera para o outro computador.
node scripts\drive.mjs iniciar
echo.
pause
