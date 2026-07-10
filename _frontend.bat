@echo off
cd /d "%~dp0archlife-frontend"
if not exist node_modules (
  echo node_modules not found, running npm install...
  call npm install
)
npm run dev
