#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
snapshot="$root/openapi/web.openapi.json"
provenance="$root/openapi/web.commit"
client="$root/src/api/generated"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

usage() {
    cat >&2 <<'USAGE'
Usage:
  gen-web-client.sh from-web <local-web-checkout> <full-web-commit>
  gen-web-client.sh from-snapshot [<exported-snapshot> <full-web-commit>]
  gen-web-client.sh --check [<external-snapshot>]
USAGE
    exit 2
}
check_sha() { [[ $1 =~ ^[0-9a-f]{40}$ ]] || usage; }

mode=${1:-}
case "$mode" in
    from-web)
        [[ $# == 3 ]] || usage
        sha=$3
        check_sha "$sha"
        # Export the committed tree even if the checkout has local edits.
        mkdir "$work/web"
        git -C "$2" archive "$sha" | tar -x -C "$work/web"
        (cd "$work/web" && cargo run --locked --quiet -- export-openapi) > "$work/web.json"
        input="$work/web.json"
        ;;
    from-snapshot)
        case $# in
            1) input=$snapshot; sha=$(cat "$provenance") ;;
            3) input=$(realpath "$2"); sha=$3 ;;
            *) usage ;;
        esac
        check_sha "$sha"
        ;;
    --check)
        [[ $# == 1 || $# == 2 ]] || usage
        sha=$(cat "$provenance")
        check_sha "$sha"
        input=$snapshot
        if [[ $# == 2 ]]; then cmp -- "$2" "$snapshot"; fi
        ;;
    *) usage ;;
esac

(cd "$root" && WEB_OPENAPI_INPUT="$input" WEB_CLIENT_OUTPUT="$work/generated" pnpm exec openapi-ts -f openapi-ts.config.mjs)
# This README belongs to the repository's documentation inventory.
cp -- "$client/README.md" "$work/generated/"
if [[ "$mode" == --check ]]; then
    diff -ru "$client" "$work/generated"
else
    mkdir -p "$(dirname "$snapshot")"
    if [[ ! $input -ef $snapshot ]]; then cp -- "$input" "$snapshot"; fi
    printf '%s\n' "$sha" > "$provenance"
    # Discard obsolete modules when the upstream schema drops an operation.
    find "$client" -mindepth 1 -maxdepth 1 ! -name README.md -exec rm -rf -- {} +
    cp -R "$work/generated/." "$client/"
fi
printf 'web %s · %s\n' "$sha" "$mode"
