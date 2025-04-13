import { readFileSync, writeFileSync } from "node:fs";

async function main() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const resolutions = { ...packageJson.resolutions };

  const manifest = await getBackstageVersionManifest('1.36.1');

  manifest.packages.forEach((pkg) => {
    if (resolutions[pkg.name]?.startsWith('patch:')) {
      console.log(`Skipping ${pkg.name} as it uses a local patch`);
      return;
    }

    // if (resolutions[pkg.name] === pkg.version) {
    //   return;
    // }
    // console.log(`Change ${pkg.name} pin from ${resolutions[pkg.name]} to ${pkg.version}`);

    resolutions[pkg.name] = pkg.version;
  });
  
  // Sort the packages by name
  packageJson.resolutions = Object.fromEntries(
    Object.entries(resolutions).sort(([a], [b]) => a.localeCompare(b)),
  );

  writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
}

async function getBackstageVersionManifest(version) {
  const res = await fetch(`https://raw.githubusercontent.com/backstage/versions/refs/heads/main/v1/releases/${version}/manifest.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch backstage package version: ${res.statusText}`);
  }
  return await res.json();
}

await main();
