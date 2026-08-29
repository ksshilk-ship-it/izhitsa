#!/bin/bash
# Bumps APP_BUILD_VERSION and every ?v= cache-bust param in главный.html.
# Reads the real system date directly (date +%m.%d) instead of relying on
# whatever date a human/assistant remembers from earlier in a conversation —
# that's exactly what kept drifting (version stuck on a stale day while the
# session continued into new real-world days).
set -euo pipefail
cd "$(dirname "$0")"

SYNC_FILE="синхронизация.js"
HTML_FILE="главный.html"

TODAY="$(date +%m.%d)"
CURRENT="$(grep -o "APP_BUILD_VERSION = '[^']*'" "$SYNC_FILE" | sed "s/APP_BUILD_VERSION = '//;s/'//")"
CURRENT_DATE="${CURRENT%.*}"
CURRENT_SEQ="${CURRENT##*.}"

if [ "$CURRENT_DATE" = "$TODAY" ]; then
  NEXT_SEQ="$(printf '%02d' $((10#$CURRENT_SEQ + 1)))"
else
  NEXT_SEQ="01"
fi
NEW_VERSION="${TODAY}.${NEXT_SEQ}"

sed -i '' "s/APP_BUILD_VERSION = '$CURRENT'/APP_BUILD_VERSION = '$NEW_VERSION'/" "$SYNC_FILE"
sed -i '' "s/v=$CURRENT/v=$NEW_VERSION/g" "$HTML_FILE"

COUNT="$(grep -c "v=$NEW_VERSION" "$HTML_FILE" || true)"
echo "Version: $CURRENT -> $NEW_VERSION"
echo "Cache-bust params updated in $HTML_FILE: $COUNT"
if [ "$CURRENT_DATE" != "$TODAY" ]; then
  echo "(date changed since last bump: $CURRENT_DATE -> $TODAY, sequence reset to 01)"
fi
