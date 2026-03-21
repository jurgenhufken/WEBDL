#!/bin/bash
echo "Screen Recorder Server starten..."
cd "$(dirname "$0")/screen-recorder-native"
npm install
npm start
