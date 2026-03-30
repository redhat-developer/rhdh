/**
 * CLI entry — dynamic plugin installer (TypeScript).
 */
import { getOciPluginPaths } from './registry-oci.js';
import { die, runMain } from './install.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--get-oci-paths') {
    const image = argv[1] || '';
    if (!image) {
      die('usage: --get-oci-paths <oci-image-ref>');
    }
    const paths = await getOciPluginPaths(image);
    for (const p of paths) {
      console.log(p);
    }
    return;
  }
  if (argv.length < 1) {
    die(`usage: ${process.argv[1] || 'install-dynamic-plugins'} <dynamic-plugins-root>`);
  }
  await runMain(argv[0]!);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
