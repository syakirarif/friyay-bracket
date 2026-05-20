#!/usr/bin/env bash
# Phase 5 smoke test. Requires dev server on :3456 and a valid admin cookie.
set -u

BASE=${BASE:-http://localhost:3456}
COOKIE=${COOKIE:?"set COOKIE='admin_auth=<value>'"}

step() { echo ""; echo "=== $1 ==="; }
post() {
  local label=$1 path=$2 body=${3:-}
  echo "→ POST $path${body:+ $body}"
  if [ -n "$body" ]; then
    curl -s -w "\n  HTTP %{http_code}\n" -X POST "$BASE$path" -b "$COOKIE" -H "Content-Type: application/json" -d "$body"
  else
    curl -s -w "\n  HTTP %{http_code}\n" -X POST "$BASE$path" -b "$COOKIE"
  fi
}

step "1. Reset"
post reset /api/admin/reset

step "2. Join 4 pilots"
for nick in Luke Leia Han Chewie; do
  curl -s -w "  $nick → %{http_code}\n" -o /dev/null -X POST "$BASE/api/join" \
    -H "Content-Type: application/json" -d "{\"nickname\":\"$nick\"}"
done

step "3. start-grouping"
post sg /api/admin/start-grouping

step "4. generate-groups (4)"
post gg /api/admin/generate-groups '{"groupCount":4}'

step "5. generate-bracket"
post gb /api/admin/generate-bracket
