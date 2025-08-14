# Guide to patching a backstage package

This guide will show you how to patch a package in Backstage using the `patch-package` tool.

## Prerequisites

- Have a `rhdh` instance locally cloned
- Have a `backstage` instance/fork locally cloned

## Manually patching a package

1. Create a new branch in your `backstage` instance for your target backstage version
1. Navigate to the `backstage` project and make your changes to the package/plugin you want to patch as if you were going to submit a PR
1. Run the following commands in the root directory of the `backstage` project, we will use the scaffolder-backend plugin (v1.23.0 for backstage v1.29.2) as an example:

   ```bash
   yarn tsc # Generate typescript types for build
   cd plugins/scaffolder-backend
   ```

1. Then in the `backstage/plugins/scaffolder-backend` directory, run the following commands:

   ```bash
   # Build the plugin
   yarn build
   # Generate the tar archive for the plugin
   npm pack .
   # Extract the contents of the tar archive
   tar -xzf scaffolder-backend-1.23.0.tgz
   rm scaffolder-backend-1.23.0.tgz
   # Rename the extracted package directory to match the package name in the @backstage/node_modules
   mv package plugin-scaffolder-backend

   # This is an optional step to remove the old .cjs.js and .cjs.js.map files in the dist/cjs directory of the package. Please refer to the caveats section for more information
   update_file_references
   # Merge the contents of the patched package into the node_modules directory of the rhdh project
   cp -Rv plugin-scaffolder-backend/* /home/user/rhdh/node_modules/@backstage/plugin-scaffolder-backend
   ```

1. Then navigate to the `rhdh` project and run the following commands to generate the patch files:

   ```bash
   # Generate the patch file
   yarn patch-package @backstage/plugin-scaffolder-backend
   # Reinstall the dependencies to verify patches were applied properly
   yarn install --force
   ```

1. Repeat for the rest of your plugins/packages

## Using the [`patch-package`](https://github.com/redhat-developer/rhdh/blob/main/scripts/patch-package.sh) script

1. Create a new branch in your `backstage` instance for your target backstage version
1. Navigate to the `backstage` project and make your changes to the package/plugin you want to patch as if you were going to submit a PR
1. Navigate to the `rhdh` project and run the `.scripts/patch-package.sh` to create a patch file for the package(s) you want to patch.

   - Script Usage: `./patch-package.sh [src] [dest] [package-name-1] [package-name-2] ...`
   - The `src` is the path to the `backstage` project containing your patch changes
   - The `dest` is the path to the `rhdh` project where the patch file will be created
   - The `package-name` array of arguments is the name of the package(s) you want to patch
   - When listing package names, please ensure it matches the package name in the `@backstage/node_modules` directory of the `rhdh` project
   - Example usage of patching a plugin and a package:

     ```bash
     ./patch-package.sh /path/to/backstage /path/to/rhdh @backstage/plugin-scaffolder-backend @backstage/integration
     ```

1. The script will create patch files in the `patches` directory of the `rhdh` project. Run `yarn install --force` in the `rhdh` project and verify that the patches were applied correctly

## Caveats

- The `patch-package` script will not work if the package you are trying to patch is not installed in the `rhdh` project
- The `patch-package` script will not be able to patch modifications to the `package.json` to add new dependencies or change the version of existing dependencies
  - You will need to manually update the `package.json` in the `rhdh` project to include the new dependencies or changes to existing dependencies since the patches are applied after the `yarn install` command is run
- The `patch-package` script will leave behind the old `.cjs.js` and `.cjs.js.map` files in the `dist/cjs` directory of the package if the resultant package's a `dist/cjs` directory that contains more than 2 files

  - This is due to the resultant file names after a build being different if any modifications were made to them.
  - The `cp -R` command would not be able to overwrite the old files with the new files since the file names would be different. However, all file references in the package should be automatically updated to point to the new files, so the behavior of the package should not be affected.

    - For example, the `dist` directory of the `catalog-backend` package in the `node_modules` would be structured like so AFTER merging the patched package:

      ```bash
      .
      ├── alpha.cjs.js
      ├── alpha.cjs.js.map
      ├── alpha.d.ts
      ├── cjs
      │   ├── CatalogBuilder-Cu6UKYtc.cjs.js # Newly Patched Version
      │   ├── CatalogBuilder-Cu6UKYtc.cjs.js.map # Newly Patched Version
      │   ├── CatalogBuilder-g0TDave-.cjs.js # Old Package
      │   └── CatalogBuilder-g0TDave-.cjs.js.map # Old Package
      ├── index.cjs.js
      ├── index.cjs.js.map
      └── index.d.ts
      ```

  - Deleting these files would result in the patches failing to apply properly due to the `patch-package` package not being able to handle patches that modify a file while also changing it's name. See <https://github.com/ds300/patch-package/issues/518>.
  - If you do want to remove the old versions of these files, you would need to follow the following procedure BEFORE merging the newly patched package with the `node_modules` package with `cp -R` (we will use the `plugin-catalog-backend` as an example):

    1. You would need to manually rename the new files to match the old file names in the patched version of the package:

       ```bash
        FILE_NAME=CatalogBuilder-Cu6UKYtc
        NEWLY_BUILT_FILE_NAME=CatalogBuilder-g0TDave-
        cd path-to-patched-package/plugin-catalog-backend/
        mv dist/cjs/${FILE_NAME}.cjs.js dist/cjs/${NEWLY_BUILT_FILE_NAME}.cjs.js
        mv dist/cjs/${FILE_NAME}.cjs.js.map dist/cjs/${NEWLY_BUILT_FILE_NAME}.cjs.js.map
       ```

    2. Update all references to the newly patched file names in the package to point to the old file names. This is automatically done for you by the `patch-package.sh` script when there are only 2 files in the `dist/cjs` directory of the package. It will skip the renaming step if there are more than 2 files in the `dist/cjs` directories, so you will need to manually update the references in those cases:

       ```bash
       cd path-to-patched-package/plugin-catalog-backend/
       find . -type f -exec sed -i "s/${NEWLY_BUILT_FILE_NAME}/${FILE_NAME}/g" {} \;
       ```

    3. Repeat for any other files that need to be renamed
    4. Merge the patched package with the `node_modules` package in the `rhdh` project
