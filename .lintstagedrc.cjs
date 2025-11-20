/**
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  ".rulesync/**/*.{md,json}": () => [
    "yarn rulesync:generate",
    "git add .cursor .claude",
  ],
  ".{cursor,claude}/**/*.{mdc,md,json}": (filenames) => {
    if (filenames.length === 0) return [];

    const hasCursor = filenames.some((f) => f.includes(".cursor/"));
    const hasClaude = filenames.some((f) => f.includes(".claude/"));

    if (hasCursor) {
      console.error("⚠️  Direct changes to .cursor detected!");
      console.error("Files triggering check:", filenames);
      console.error("💡 To sync back to .rulesync, run:");
      console.error("   yarn rulesync:import:cursor\n");
    }

    if (hasClaude) {
      console.error("⚠️  Direct changes to .claude detected!");
      console.error("Files triggering check:", filenames);
      console.error("💡 To sync back to .rulesync, run:");
      console.error("   yarn rulesync:import:claude\n");
    }

    throw new Error(
      `❌ Direct changes to ${
        hasCursor && hasClaude
          ? ".cursor and .claude"
          : hasCursor
          ? ".cursor"
          : ".claude"
      } are not allowed.`
    );
  },
};
