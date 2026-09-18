@echo off
title Fish Audio Live Voice Changer Studio
cd /d "%~dp0"
echo ============================================================
echo   Iniciando Fish Audio Voice Changer Studio...
echo ============================================================
start http://localhost:7860
python server.py
pause
