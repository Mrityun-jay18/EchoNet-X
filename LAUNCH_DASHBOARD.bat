@echo off
title EchoNet X Dashboard Server Launcher
cd /d "%~dp0"
echo Starting EchoNet X Tactical Dashboard Server on http://127.0.0.1:8080 ...
start "" "http://127.0.0.1:8080"
"C:\Users\surij\AppData\Local\Programs\Python\Python312\python.exe" server.py
pause
