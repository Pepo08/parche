#!/usr/bin/env bash
# Demo de punta a punta: copia la tienda de ejemplo a un repo git temporal y corre Parche como lo vería un cliente.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PARCHE="node $HERE/bin/parche.js"
REPO="$(mktemp -d)/tienda-demo"

cp -r "$HERE/examples/tienda-demo" "$REPO"
rm -rf "$REPO/.parche"
cd "$REPO"
git init -q -b main
git -c user.name=demo -c user.email=demo@demo add -A
git -c user.name=demo -c user.email=demo@demo commit -q -m "Tienda Demo"

echo "════════ 1. parche scan ════════"
$PARCHE scan .

echo
echo "════════ 2. parche pr (ARCA y Mercado Pago, verificando con los tests del repo) ════════"
$PARCHE pr . --dry-run --verify

echo
echo "════════ 3. Ramas y diffs que quedarían como PR ════════"
for b in $(git branch --format='%(refname:short)' | grep '^parche/'); do
  echo "── $b"
  git diff --stat "main..$b"
done

echo
echo "════════ 4. Diff del PR de ARCA ════════"
git diff "main..parche/arca.wsfe.condicion-iva-receptor"

echo
echo "Cuerpos de los PRs:"
ls -1 "$REPO"/.parche/pr-*.md
echo "Repo de la demo: $REPO"
