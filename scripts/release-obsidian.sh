#!/usr/bin/env bash
# Build the Obsidian plugin and release it.
#   scripts/release-obsidian.sh           builds and shows what would be released
#   scripts/release-obsidian.sh --publish pushes tag obsidian-v<version>; the Release Obsidian plugin workflow
#                                         builds it and attaches main.js, manifest.json and THIRD-PARTY-LICENSES.txt
# The version is the one in obsidian/manifest.json; bump it first.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./obsidian/manifest.json').version")
tag="obsidian-v${version}"

npm run build:obsidian
ls -l obsidian/dist/main.js obsidian/dist/manifest.json obsidian/dist/THIRD-PARTY-LICENSES.txt

if [[ "${1:-}" != "--publish" ]]; then
  echo "Would create release ${tag}. Run again with --publish."
  exit 0
fi

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null || git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1; then
  echo "Tag ${tag} exists; bump the version in obsidian/manifest.json." >&2
  exit 1
fi
git fetch -q origin main
if [[ -n "$(git status --porcelain obsidian src)" || "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "Tag from a clean, up-to-date main so the release matches what was reviewed." >&2
  exit 1
fi
git tag "$tag"
git push origin "$tag"
echo "Pushed ${tag}. Watch it: gh run list --workflow release-obsidian.yml"
