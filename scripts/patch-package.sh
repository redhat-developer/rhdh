#!/bin/bash

generate_backstage_package(){
  PKG_NAME=$1
  if [[ $PKG_NAME =~ ^plugin-(.*) ]]; then
    cd ${SRC_REPO_PATH}/plugins/${PKG_NAME:7} || return 1
    echo "Changed directory to $(pwd)"
  else
    cd ${SRC_REPO_PATH}/packages/${PKG_NAME} || return 1
    echo "Changed directory to $(pwd)"
  fi

  echo "Building ${PKG_NAME}"
	yarn build || return 1
  # Extract the name of the resultant tar file
	PACKAGE_TAR=$(npm pack . | tail -1)
  echo "Generated Tar File: ${PACKAGE_TAR}"
  tar -xvzf ${PACKAGE_TAR}
  # Remove old extracted tar file if it exists
  rm -rf ./${PKG_NAME}
  # Extracted tar file will be a `package/` directory
  mv -vf ./package ./${PKG_NAME}

  # Remove the tar file
  rm ${PACKAGE_TAR}

  patch_backstage_package ${PKG_NAME}

  # Remove extracted tar file after the patches are generated
  rm -rf ./${PKG_NAME}
}

replace_references(){
  SRC_PACKAGE_PATH=$1
  DEST_PACKAGE_PATH=$2
  MODULE_TYPE=$3 # cjs or esm


  SRC_CJS_PATH="${SRC_PACKAGE_PATH}/dist/${MODULE_TYPE}"
  DEST_CJS_PATH="${DEST_PACKAGE_PATH}/dist/${MODULE_TYPE}"

  if [ -d "${DEST_CJS_PATH}" ] &&  [ -d "${SRC_CJS_PATH}" ]; then
    # TODO: Grab ALL cjs file names
    if [ $(find ${SRC_CJS_PATH} -type f | wc -l) -ne 2 ] || [ $(find ${DEST_CJS_PATH} -type f | wc -l) -ne 2 ]; then
      echo "This script only supports file renaming for one pair of files in the dist/${MODULE_TYPE} directory" >&2
      echo "It may be necessary to manually rename and update references in ${DEST_CJS_PATH}" >&2
      return 1
    fi

    # FIXME: Add support for when there are more than one pair in the `cjs` directory
    FILE_NAME=$(ls "${DEST_PACKAGE_PATH}/dist/${MODULE_TYPE}" | tail -1 | cut -d '.' -f 1);
    NEWLY_BUILT_FILE_NAME=$(ls "${SRC_PACKAGE_PATH}/dist/${MODULE_TYPE}" | tail -1 | cut -d '.' -f 1);

    echo "Original File Name: ${FILE_NAME}"
    echo "Newly Generated File Name: ${NEWLY_BUILT_FILE_NAME}"


    echo "Renaming files in the ${SRC_CJS_PATH} directory"
    # This makes the assumption that file names do not contains spaces or glob characters
    filePair=($(find ${SRC_CJS_PATH} -type f -name ${NEWLY_BUILT_FILE_NAME}.*));
    for file in ${filePair[@]}; do
      mv -vf "${file}" "${SRC_CJS_PATH}/${FILE_NAME}.${file#*.}"
    done;

    # Update references to the cjs files
    find ${SRC_PACKAGE_PATH} -type f -exec sed -i "s/${NEWLY_BUILT_FILE_NAME}/${FILE_NAME}/g" {} \;
  fi
}
patch_backstage_package(){
  PKG_NAME=$1

  if [[ $PKG_NAME =~ ^plugin-(.*) ]]; then
    SRC_PACKAGE_PATH="${SRC_REPO_PATH}/plugins/${PKG_NAME:7}/${PKG_NAME}"
  else
    SRC_PACKAGE_PATH="${SRC_REPO_PATH}/packages/${PKG_NAME}/${PKG_NAME}"
  fi

  DEST_PACKAGE_PATH="${DEST_REPO_PATH}/node_modules/@backstage/${PKG_NAME}"

  # We want to preserve the name of the files. The only files that have name changes with each rebuilt are
  # the files in the `/dist/cjs` directories from backend plugins
  # See https://github.com/ds300/patch-package/issues/518
  # FIXME: Currently function does not work when there are more than one pair of files in the folder
  replace_references ${SRC_PACKAGE_PATH} ${DEST_PACKAGE_PATH} 'cjs'

  echo "Performing a diff before the merge (after the file renaming attempt)"
  echo "============================================================="
  diff -r --brief ${DEST_PACKAGE_PATH} ${SRC_PACKAGE_PATH}

  # Snapshot the unpatched package before merging
  DEST_PACKAGE_COPY=/tmp/${PKG_NAME}-copy
  mkdir ${DEST_PACKAGE_COPY}
  rsync -a ${DEST_PACKAGE_PATH}/* ${DEST_PACKAGE_COPY}

  echo "============================================================="
  echo "Attempt to merge the package contents"
  # Merge the packages.
  # Note: This will replace the package.json with the one from `yarn build` which may include `^workspace` versions
  # This should not matter since the `patch-package` package does not apply diff for `package.json`
  if [ -d "${SRC_PACKAGE_PATH}" ] && [ "$(ls -A ${SRC_PACKAGE_PATH})" ]; then
    cp -Rv ${SRC_PACKAGE_PATH}/* ${DEST_PACKAGE_PATH}
  else
    echo "Source directory does not exist or is empty" >&2
  fi

  echo "Performing a diff between unpatched and patched package after the merge"
  echo "============================================================="
  diff -r --brief ${DEST_PACKAGE_PATH} ${DEST_PACKAGE_COPY}
  rm -rf ${DEST_PACKAGE_COPY}
}

patch_packages(){
  cd ${SRC_REPO_PATH} || return 1
  echo "Changed directory to $(pwd)"
  # Run to regenerates dist types and such.
  echo "Running yarn tsc, this might take a minute or two..."
  yarn tsc

  echo "Generating Patches for the following plugins/packages: ${targetPcks[*]}"
  for pck in ${targetPcks[@]}; do
    cd ${SRC_REPO_PATH} || continue
    echo "Changed directory to $(pwd)"
    echo "Generating patches for ${pck}"

    generate_backstage_package ${pck}

    cd ${DEST_REPO_PATH} || continue
    echo "Changed directory to $(pwd)"

    yarn patch-package "@backstage/${pck}"
    echo "=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-="
  done;

}

function display_help() {
		echo "A utility script to create patches for packages in the backstage/backstage repository for your backstage instance"
		echo
    echo "Usage: $0 [src] [dest] [package-name-1] [package-name-2] ..."
		echo
    echo "src: The root of the backstage monorepo with the patched changes."
    echo "dest: The root of the target backstage monorepo containing the node_modules that are to be patched."
    echo "package-name-n: a list of package names separated by a space. These should match the package names in the \`node_modules/@backstage\` directory"
    printf "\tIf patching a plugin, append a \`plugin-\` to the package name, ex: \`plugin-scaffolder-backend\`."
    printf "\n\tIf patching a package, just provide the package name that matches the corresponding package name in the \`node_modules\`, ex: \`integration\`\n"
    echo "Please note that if the resultant package has a dist/cjs directory containing more than 2 files, the user may need to manually update file names and references"
}

for arg in "$@"
do
  if [[ $arg == "--help" ]]; then
      display_help
      exit 0
  fi
done

if [[ $# -lt 3 ]]; then
  echo "Error: Invalid number of arguments." >&2
  display_help
  exit 1
fi

# Convert to absolute path (if relative path is provided)
SRC_REPO_PATH=$(readlink -f $1)
DEST_REPO_PATH=$(readlink -f $2)

# Shift the first 2 arguments (src and dest)
shift 2

# Store the remaining arguments as package names
targetPcks=("$@")

patch_packages
