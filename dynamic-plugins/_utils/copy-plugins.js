const fs = require("fs").promises; // Use the promises API
const path = require("path");
const process = require("process");

// Helper function to check if a directory exists
async function directoryExists(dirPath) {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error; // Re-throw unexpected errors
  }
}

async function main() {
  process.chdir(path.join(__dirname, ".."));

  if (!process.argv[2]) {
    console.log("Usage: node copy-plugins.js <destination directory>");
    process.exit(1);
  }

  const destination = process.argv[2];
  // Ensure destination exists using async mkdir
  await fs.mkdir(destination, { recursive: true });
  console.log(`Ensured destination directory exists: ${destination}`);

  const wrappersDir = path.join(".", "wrappers");

  // Read directories asynchronously
  const dirents = await fs.readdir(wrappersDir, { withFileTypes: true });

  const wrapperDirs = dirents
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(wrappersDir, dirent.name));

  // Create an array of promises, one for each directory processing task
  const copyPromises = wrapperDirs.map(async (directory) => {
    try {
      const distDynamicDir = path.join(directory, "dist-dynamic");
      let packageToCopy = directory; // Default source

      // Check asynchronously if dist-dynamic exists and is a directory
      if (await directoryExists(distDynamicDir)) {
        packageToCopy = distDynamicDir;
      }

      const pkgJsonPath = path.join(packageToCopy, "package.json");
      let pkgJson;
      try {
        // Read and parse package.json asynchronously
        const pkgJsonContent = await fs.readFile(pkgJsonPath, "utf-8");
        pkgJson = JSON.parse(pkgJsonContent);
      } catch (error) {
        if (error.code === "ENOENT") {
          console.error(
            `Skipping '${directory}': No 'package.json' found in '${packageToCopy}'`,
          );
          return; // Skip this directory successfully (promise resolves)
        }
        // Re-throw other read/parse errors
        throw new Error(
          `Error reading package.json from ${pkgJsonPath}: ${error.message}`,
        );
      }

      if (!pkgJson?.name) {
        console.error(
          `Skipping '${directory}': Invalid 'package.json' in '${packageToCopy}' (missing 'name' attribute).`,
        );
        return; // Skip this directory successfully (promise resolves)
      }

      const copyName = pkgJson.name.replace(/^@/, "").replace(/\//, "-");
      const destinationDir = path.join(destination, copyName);
      // Get the real path of the source directory asynchronously
      const sourceRealPath = await fs.realpath(packageToCopy);

      console.log(
        `Processing ${pkgJson.name}: Copying ${sourceRealPath} to ${destinationDir}`,
      );

      // Remove destination directory asynchronously
      await fs.rm(destinationDir, { recursive: true, force: true });

      // Copy directory asynchronously
      await fs.cp(sourceRealPath, destinationDir, { recursive: true });

      console.log(`Finished copying ${pkgJson.name} to ${destinationDir}`);
    } catch (error) {
      // Log the error and re-throw to make Promise.all fail
      console.error(`Error processing directory '${directory}':`, error);
      throw error;
    }
  });

  // Wait for all copy operations to complete
  try {
    await Promise.all(copyPromises);
    console.log("\nAll plugins copied successfully.");
  } catch (error) {
    // Error is already logged in the individual promise catch block
    console.error("\nOne or more plugins failed to copy. See errors above.");
    process.exit(1); // Exit with error status
  }
}

// Run the main async function and catch any top-level errors
main().catch((err) => {
  console.error("Script execution failed:", err);
  process.exit(1);
});
