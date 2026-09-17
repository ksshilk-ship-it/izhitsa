#!/bin/bash
# Bumps APP_VERSION in izhitsa-workshop.html and CACHE_NAME in
# izhitsa-workshop-sw.js. Format: DD.MM.NN (day.month.sequence — day first,
# per how this app's version has been requested to read). Reads the real
# system date via `date +%d.%m` rather than trusting a conversation's
# remembered date, so the sequence resets correctly even across sessions
# that span real-world days.
set -euo pipefail
cd "$(dirname "$0")"

HTML_FILE="izhitsa-workshop.html"
SW_FILE="izhitsa-workshop-sw.js"

TODAY="$(date +%d.%m)"
CURRENT="$(grep -o "APP_VERSION = '[^']*'" "$HTML_FILE" | head -1 | sed "s/APP_VERSION = '//;s/'//")"
CURRENT_DATE="${CURRENT%.*}"
CURRENT_SEQ="${CURRENT##*.}"

if [ "$CURRENT_DATE" = "$TODAY" ]; then
  NEXT_SEQ="$(printf '%02d' $((10#$CURRENT_SEQ + 1)))"
else
  NEXT_SEQ="01"
fi
NEW_VERSION="${TODAY}.${NEXT_SEQ}"

sed -i '' "s/APP_VERSION = '$CURRENT'/APP_VERSION = '$NEW_VERSION'/" "$HTML_FILE"

SW_CURRENT="$(grep -o "izhitsa-workshop-v[0-9]*" "$SW_FILE" | head -1)"
SW_NUM="${SW_CURRENT##*-v}"
SW_NEXT="izhitsa-workshop-v$((SW_NUM + 1))"
sed -i '' "s/$SW_CURRENT/$SW_NEXT/g" "$SW_FILE"

echo "APP_VERSION: $CURRENT -> $NEW_VERSION"
echo "SW cache:    $SW_CURRENT -> $SW_NEXT"
if [ "$CURRENT_DATE" != "$TODAY" ]; then
  echo "(date changed since last bump: $CURRENT_DATE -> $TODAY, sequence reset to 01)"
fi
echo "$NEW_VERSION"
