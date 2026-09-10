@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ESTACAO 1 - Parar Portal

if exist logs\server.pid (
  set /p PID=<logs\server.pid
  if not "%PID%"=="" taskkill /F /PID %PID% >nul 2>&1
  del /q logs\server.pid >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo [OK] Portal encerrado.
timeout /t 2 /nobreak >nul
