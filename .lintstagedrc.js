/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  ".rulesync/**/*.{md,json}": () => [
    "yarn rulesync:generate",
    "git add .cursor .claude",
  ],
  ".cursor/**/*.{mdc,md,json}": () => {
    console.error("\n⚠️  Direct changes to .cursor detected!");
    console.error("💡 To sync back to .rulesync, run:");
    console.error("   yarn rulesync:import:cursor\n");
    return [];
  },
  ".claude/**/*.{md,json}": () => {
    console.error("\n⚠️  Direct changes to .claude detected!");
    console.error("💡 To sync back to .rulesync, run:");
    console.error("   yarn rulesync:import:claude\n");
    return [];
  },
};
