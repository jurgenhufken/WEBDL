#!/bin/bash
cd "$(dirname "$0")"

echo "🔍 WEBDL Directory Filter"
echo "=========================="
echo ""

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment niet gevonden!"
    echo ""
    echo "Setup venv met:"
    echo "  python3 -m venv venv"
    echo "  venv/bin/pip install PySide6"
    echo ""
    read -p "Druk op Enter om te sluiten..."
    exit 1
fi

# Check if PySide6 is installed in venv
if ! venv/bin/python3 -c "import PySide6" 2>/dev/null; then
    echo "❌ PySide6 niet geïnstalleerd in venv!"
    echo ""
    echo "Installeer met:"
    echo "  venv/bin/pip install PySide6"
    echo ""
    read -p "Druk op Enter om te sluiten..."
    exit 1
fi

# Launch directory filter with venv python
venv/bin/python3 webdl-directory-filter.py

echo ""
echo "✅ Klaar! Refresh je gallery om wijzigingen te zien."
echo ""
read -p "Druk op Enter om te sluiten..."
