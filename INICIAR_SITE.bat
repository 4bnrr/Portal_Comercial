@echo off
setlocal EnableExtensions
title ESTACAO 1 - Portal Comercial
cd /d "%~dp0"

if not exist "node_modules\dotenv" (
  echo Dependencias ausentes. Executando instalacao automatica...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

echo Iniciando Estacao 1...
echo Nao feche esta janela enquanto o site estiver em uso.
echo.
node server.js
pause
