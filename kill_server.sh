#!/bin/bash

echo "Zoeken naar processen die poort 35729 gebruiken..."
PID=$(lsof -ti:35729)

if [ -z "$PID" ]; then
  echo "Geen proces gevonden dat poort 35729 gebruikt."
else
  echo "Proces(sen) gevonden op poort 35729: $PID"
  echo "Process(en) stoppen..."
  kill -9 $PID
  echo "Process(en) gestopt."
fi

echo "Klaar. Je kunt nu het StartServer.command script opnieuw starten."
