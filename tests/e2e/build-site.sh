#!/bin/sh
# Copy the site into tests/e2e/site and swap the CDN supabase-js import for the harness client.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SITE="$ROOT/tests/e2e/site"
rm -rf "$SITE" && mkdir -p "$SITE"
cp -r "$ROOT"/*.html "$ROOT/assets" "$SITE/"
cp "$ROOT/tests/e2e/mock-supabase.js" "$SITE/assets/js/mock-supabase.js"
sed -i "s#import { createClient } from\$##; s#^  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';#import { createClient } from './mock-supabase.js';#" "$SITE/assets/js/supabase-client.js"
