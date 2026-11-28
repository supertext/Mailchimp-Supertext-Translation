#!/usr/bin/env bash
# OWASP ZAP scan of the built app against the stand-in Mailchimp and Supertext APIs, logged in
# (the second layer of the security audit; CI: .github/workflows/security-scan.yml).
#   npm run build && bash scripts/zap.sh            # baseline: spider + passive checks
#   npm run build && bash scripts/zap.sh full       # also the active scan (attacks; local only)
# Needs Docker (image ghcr.io/zaproxy/zaproxy:stable, or ZAP_IMAGE). The report goes to zap-report/.
# Exit code 0: no alerts beyond the accepted ones in .zap/rules.tsv; otherwise ZAP's (1: failures,
# 2: warnings). Forms are not submitted by the spider, so Disconnect doesn't end the session.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=${1:-baseline}
work=$(mktemp -d)
jar="$work/cookies"
app=http://127.0.0.1:8080
mc=http://127.0.0.1:8766
out="$PWD/zap-report"
mkdir -p "$out"
chmod 777 "$out"
cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT

npx tsx tests/standin/server.ts > "$work/standin.log" 2>&1 &
MAILCHIMP_CLIENT_ID=zap MAILCHIMP_CLIENT_SECRET=zap-secret MAILCHIMP_LOGIN_BASE=$mc \
SUPERTEXT_API_ENDPOINT=http://127.0.0.1:8765/v1/ SUPERTEXT_API_KEY=zap-key SUPERTEXT_API_KEY_ACCOUNT=48210377 SUPERTEXT_REPORT_URL=http://127.0.0.1:8765/report \
APP_URL=$app SESSION_SECRET=zap-session PORT=8080 \
  node dist/server.js > "$work/app.log" 2>&1 &
for i in $(seq 1 30); do curl -fs $app/health > /dev/null && curl -fs $mc/3.0/ping -H 'Authorization: Bearer standin-token' > /dev/null && break; sleep 1; done

# Connect through the stand-in's OAuth and save settings, so the scan sees the pages of a connected account.
curl -fs -L -c "$jar" -b "$jar" -o /dev/null $app/oauth/start
settings=$(curl -fs -c "$jar" -b "$jar" $app/settings)
csrf=$(grep -o 'data-csrf="[^"]*"' <<< "$settings" | head -1 | sed -E 's/data-csrf="([^"]*)"/\1/')
curl -fs -c "$jar" -b "$jar" -o /dev/null -X POST $app/settings \
  --data-urlencode "csrf=$csrf" -d sourceLanguage=en -d target=de -d target=fr -d code:de=de-CH -d code:fr=fr-CH \
  -d folderTrigger=1 -d appTrigger=1 -d tone=default
session=$(awk '$6 == "st_session" { print $7 }' "$jar")
[ -n "$session" ] || { echo "No session cookie"; cat "$work/app.log"; exit 1; }

# The session cookie on every request ZAP sends; no form posts by the spider.
zap_options="-config replacer.full_list(0).description=session \
-config replacer.full_list(0).enabled=true \
-config replacer.full_list(0).matchtype=REQ_HEADER \
-config replacer.full_list(0).matchstr=Cookie \
-config replacer.full_list(0).regex=false \
-config replacer.full_list(0).replacement=st_session=$session \
-config spider.postForm=false -config spider.processForm=false"

# Alerts the app accepts: .zap/rules.tsv (copied next to the report, where ZAP reads it).
cp .zap/rules.tsv "$out/rules.tsv"
script=zap-baseline.py
[ "$mode" = full ] && script=zap-full-scan.py
status=0
docker run --rm --network host -v "$out:/zap/wrk:rw" -t "${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}" \
  "$script" -t "$app/" -m 3 -c rules.tsv -r report.html -J report.json -w report.md \
  -z "$zap_options" || status=$?
echo "ZAP finished (exit $status); report in $out"
grep -q 'Supertext: Mailchimp account .* connected' "$work/app.log" || { echo "The app log doesn't show the login"; exit 1; }
exit $status
