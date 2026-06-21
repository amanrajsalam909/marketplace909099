#!/usr/bin/env bash
# Launch the RajkotMarket ERP desktop app.
# Uses a system `mvn` if present, otherwise the local Maven under ~/.local/opt.
set -e
cd "$(dirname "$0")"

if command -v mvn >/dev/null 2>&1; then
  MVN=mvn
elif [ -x "$HOME/.local/opt/apache-maven-3.9.11/bin/mvn" ]; then
  MVN="$HOME/.local/opt/apache-maven-3.9.11/bin/mvn"
else
  echo "Maven not found. Install it (e.g. 'sudo apt install maven') or see README.md." >&2
  exit 1
fi

exec "$MVN" javafx:run
