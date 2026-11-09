#!/usr/bin/env bash
# Smoke test of the built app against the stand-in Mailchimp and Supertext APIs
# (CI runs it; locally: npm run build && bash scripts/smoke.sh).
# Connects Mailchimp through OAuth, saves the settings, translates a campaign
# from the app, then moves one into a Supertext folder and waits for the poller.
set -euo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d)
jar="$work/cookies"
app=http://127.0.0.1:8080
mc=http://127.0.0.1:8766
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

npx tsx tests/standin/server.ts > "$work/standin.log" 2>&1 &
MAILCHIMP_CLIENT_ID=ci MAILCHIMP_CLIENT_SECRET=ci-secret MAILCHIMP_LOGIN_BASE=$mc \
SUPERTEXT_API_ENDPOINT=http://127.0.0.1:8765/v1/ SUPERTEXT_API_KEY=ci-key SUPERTEXT_REPORT_URL=http://127.0.0.1:8765/report \
APP_URL=$app SESSION_SECRET=ci-session FOLDER_POLL_SECONDS=1 PORT=8080 \
  node dist/server.js > "$work/app.log" 2>&1 &
for i in $(seq 1 30); do curl -fs $app/health > /dev/null && curl -fs $mc/3.0/ping -H 'Authorization: Bearer standin-token' > /dev/null && break; sleep 1; done

fail() { echo "FAILED: $1"; echo '--- app.log'; cat "$work/app.log"; echo '--- standin.log'; cat "$work/standin.log"; exit 1; }

start=$(curl -fs -c "$jar" -b "$jar" $app/)
grep -q 'Connect Mailchimp' <<< "$start" || fail 'connect page'
curl -fs -L -c "$jar" -b "$jar" -o /dev/null $app/oauth/start || fail 'OAuth flow'
settings=$(curl -fs -c "$jar" -b "$jar" $app/settings)
grep -q 'Swiss Chocolate Co.' <<< "$settings" || fail 'settings page after connecting'
csrf=$(grep -o 'data-csrf="[^"]*"' <<< "$settings" | head -1 | sed -E 's/data-csrf="([^"]*)"/\1/')
curl -fs -c "$jar" -b "$jar" -o /dev/null -X POST $app/settings \
  --data-urlencode "csrf=$csrf" -d sourceLanguage=en -d target=de -d target=fr -d code:de=de-CH -d code:fr=fr-CH \
  -d folderTrigger=1 -d appTrigger=1 -d limitOriginal=1 -d tone=default || fail 'saving settings'
curl -fs -o /dev/null $app/static/app.js || fail 'static files'

page=$(curl -fs -c "$jar" -b "$jar" $app/)
grep -q 'Autumn newsletter' <<< "$page" || fail 'campaign list'
job=$(curl -fs -c "$jar" -b "$jar" -X POST $app/api/jobs -H "X-CSRF-Token: $csrf" -H 'Content-Type: application/json' \
  -d '{"campaignId":"c-autumn","languages":["de","fr"]}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
for i in $(seq 1 30); do
  status=$(curl -fs -c "$jar" -b "$jar" "$app/api/jobs/$job")
  grep -q '"status":"running"' <<< "$status" || break
  sleep 1
done
grep -q 'Done: 2 created, 0 updated, 0 kept, 0 failed.' <<< "$status" || fail "app job: $status"
campaigns=$(curl -fs "$mc/3.0/campaigns?count=50" -H 'Authorization: Bearer standin-token')
grep -q 'Unsere Herbstschokoladen sind da' <<< "$campaigns" || fail 'German draft in Mailchimp'

# Folder trigger: move the Advent campaign into "Supertext → German".
folder=$(curl -fs "$mc/3.0/campaign-folders" -H 'Authorization: Bearer standin-token' | grep -o '"id":"[^"]*","name":"Supertext → German"' | sed -E 's/"id":"([^"]*)".*/\1/')
[ -n "$folder" ] || fail 'Supertext folders in Mailchimp'
curl -fs -o /dev/null -X PATCH "$mc/3.0/campaigns/c-advent" -H 'Authorization: Bearer standin-token' -H 'Content-Type: application/json' \
  -d "{\"settings\":{\"folder_id\":\"$folder\"}}"
for i in $(seq 1 30); do
  campaigns=$(curl -fs "$mc/3.0/campaigns?count=50" -H 'Authorization: Bearer standin-token')
  grep -q 'Advent calendar offer · DE' <<< "$campaigns" && break
  sleep 1
done
grep -q 'Ihr Adventskalender kann bestellt werden' <<< "$campaigns" || fail 'draft from the folder trigger'
# The draft appears a moment before the original is moved back: wait for both.
for i in $(seq 1 10); do
  advent=$(curl -fs "$mc/3.0/campaigns/c-advent" -H 'Authorization: Bearer standin-token')
  grep -q '"folder_id":"f-seasonal"' <<< "$advent" && break
  sleep 1
done
grep -q '"folder_id":"f-seasonal"' <<< "$advent" || fail 'original moved back to its folder'

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $app/api/jobs -H 'Content-Type: application/json' -d '{}')
[ "$code" = "401" ] || fail "API without a session answered $code"
echo 'Smoke test passed.'
