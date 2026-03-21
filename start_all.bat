@echo off
echo Screen Recorder Server starten...
cd %~dp0screen-recorder-native
npm install
npm start
