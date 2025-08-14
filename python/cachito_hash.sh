#!/bin/bash
#
# Copyright (c) 2023 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# see README.requirements.md -- this is used to regenerate the sha256 sums in the .in and .txt files

SCRIPT_DIR=$(cd "$(dirname "$0")" || exit; pwd)
pushd "$SCRIPT_DIR" >/dev/null || exit
# update the sha256: values in requirements.in and requirements-build.in files 
for file in requirements.in requirements-build.in; do
    echo "Update $file ..."
    #shellcheck disable=SC2013
    pip-compile --quiet --allow-unsafe --output-file="${file/\.in/\.txt}" --strip-extras "${file}"
    for d in $(grep https://github $file); do
        oldSHA=${d#*sha256:}; # echo $oldSHA
        url=${d%#egg=*}; # echo $url
        archive=${url%/*.zip}
        zip=${url##*/}
        echo " Fetch $url"
        curl -sSLo dep.zip "$url"
        SHA=$(sha256sum dep.zip); SHA=${SHA%  dep.zip}
        rm -f dep.zip
        echo "   Set new SHA = $SHA"
        sed -i "$file" -r -e "s/sha256:${oldSHA}/sha256:${SHA}/"
        # now regen and update the .txt versions of the .in files, plus the readme examples too
        echo "   Set $archive/$zip#cachito_hash=sha256:$SHA"
        for hashed in "${file/\.in/\.txt}" "README.requirements.md"; do
            sed -i "$hashed" -r -e "s@(${archive}).+@\1\/$zip#cachito_hash=sha256:${SHA}@"
        done
    done
done
popd >/dev/null || exit
