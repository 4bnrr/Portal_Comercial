@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ESTACAO 1 - Instalacao
cls
echo ============================================================
echo       ESTACAO 1 - INSTALACAO LIMPA SEM LOGIN
echo ============================================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Tentando instalar Node.js 22 pelo WinGet...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo [ERRO] WinGet nao encontrado. Instale Node.js 22 LTS e rode novamente.
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.22 -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar Node.js.
    pause
    exit /b 1
  )
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
echo [OK] Node.js encontrado:
node -v
echo.
echo Instalando dependencias pequenas do servidor...
call npm install --omit=dev
if errorlevel 1 (
  echo [ERRO] npm install falhou. Verifique a internet e tente novamente.
  pause
  exit /b 1
)
if not exist .env (
  echo.
  echo Agora vamos configurar o CVCRM.
  call CONFIGURAR_CVCRM.bat
)
if not exist data mkdir data
if not exist data\uploads mkdir data\uploads
if not exist logs mkdir logs
netsh advfirewall firewall add rule name="ESTACAO 1 Portal 3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo.
echo ============================================================
echo [OK] INSTALACAO CONCLUIDA
echo ============================================================
echo Nao ha banco MySQL/MariaDB e nao ha etapa de build.
echo Para abrir o portal use INICIAR_SITE.bat.
echo.
pause
