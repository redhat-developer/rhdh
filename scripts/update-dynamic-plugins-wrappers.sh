#!/bin/bash
#
# Copyright (c) 2024-2025 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Utility script to update package.json files to include the latest published y (minor) or z (patch) updates

# allow y-stream updates for './scripts/update-dynamic-plugins-wrappers.sh --minor'

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

usage () {
	echo "
Usage: 
  $0 [--minor] [--force]
  
Options:
    --minor    also do minor updates (default: patch updates only)
    --force    re-apply changes even if the version is the same
"
}

DO_MINOR=0
FORCE=0

while [[ "$#" -gt 0 ]]; do
  case $1 in
    '--minor') DO_MINOR=1; shift 1;;
    '--force') FORCE=1; shift 1;;
    *) echo "Unsupported flag '$1'"; usage; exit 1;
  esac
done

for j in ./dynamic-plugins/wrappers/*/package.json; do
  (( c = c + 1 ))
done
for j in ./dynamic-plugins/wrappers/*/package.json; do
  (( i = i + 1 ))
  echo
  Plugin=$(jq -r '.name' "$j")
  echo -n "[$i/$c] Diff $j ($Plugin / "
  VersionXYZ=$(jq -r '.version' "$j")
  VersionXY=${VersionXYZ%.*}
  if [[ $Plugin != "@"* ]]; then 
    Plugin="$(echo "${Plugin}" | sed -r -e 's/([^-]+)-(.+)/\@\1\/\2/' \
        -e 's|janus/idp-|janus-idp/|' \
        -e 's|red/hat-developer-hub-|red-hat-developer-hub/|' \
        -e 's|backstage/community-|backstage-community/|' \
        -e 's|parfuemerie/douglas-|parfuemerie-douglas/|')"
  fi
  echo "$Plugin) ..."
  allVersionsPublished="$(curl -sSLko- "https://registry.npmjs.org/${Plugin/\//%2f}" | jq -r '.versions[].version')"
  # echo $allVersionsPublished
  # clean out any pre-release versions
  if [[ $DO_MINOR -eq 1 ]]; then
    # echo "looking for newer plugin $VersionXYZ --> ${VersionXY%.*}.*.*"
    latestRelease="$(echo "$allVersionsPublished" | grep -v -E -- "next|alpha|-" | grep -E "^${VersionXY%.*}" | sort -uV | tail -1)"
  else 
    # echo "looking for newer plugin $VersionXYZ --> ${VersionXY}.*"
    latestRelease="$(echo "$allVersionsPublished" | grep -v -E -- "next|alpha|-" | grep -E "^${VersionXY}" | sort -uV | tail -1)"
  fi
  # echo "[DEBUG] Latest x.y version at https://registry.npmjs.org/${Plugin/\//%2f} : $latestRelease"
  if [[ "$latestRelease" != "$VersionXYZ" ]] || [[ $FORCE -eq 1 ]]; then
    if [[ $i -gt 9 ]]; then echo -n " "; fi
    echo "       Bump $VersionXYZ -> $latestRelease from https://www.npmjs.com/package/$Plugin/v/$latestRelease"
    jq '.version = "'"$latestRelease"'"' "$j" > "$j"_; mv -f "$j"_ "$j"
    sed -i "$j" -r -e 's|("'"$Plugin"'": )".+"|\1"'"$latestRelease"'"|'
  fi
done
