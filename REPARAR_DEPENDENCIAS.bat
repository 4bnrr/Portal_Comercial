@echo off
setlocal
title ESTACAO 1 - Reparar Dependencias
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao encontrado. Instale o Node.js LTS.
  pause
  exit /b 1
)

echo Reinstalando dependencias...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /q "package-lock.json"
call npm install --no-audit --no-fund

if errorlevel 1 (
  echo [ERRO] Falha na instalacao.
) else (
  echo [OK] Dependencias reinstaladas.
)
pause
