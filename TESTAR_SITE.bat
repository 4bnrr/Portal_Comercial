@echo off
setlocal
cd /d "%~dp0"
title ESTACAO 1 - Teste rapido
powershell -NoProfile -Command "try {$r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/status -TimeoutSec 3; Write-Host '[OK] Servidor respondeu:' $r.StatusCode; Write-Host $r.Content} catch {Write-Host '[ERRO]' $_.Exception.Message; exit 1}"
pause
