"""CVE scoring regressions for colored Yarn output and PR leftover tables."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCORER = Path(__file__).resolve().parents[1] / "cve-review-score.py"


def _load_scorer():
    spec = importlib.util.spec_from_file_location("cve_review_score", SCORER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CveReviewScoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.score_mod = _load_scorer()

    def score(
        self,
        title,
        body,
        packages,
        *,
        colored=False,
        why_versions=None,
        lockfile_packages=None,
        empty_why=(),
        custom_why=None,
    ):
        """Score advisories for ``packages``.

        why_versions: optional {name: version_string} overriding installed ver.
        lockfile_packages: if set, write a yarn.lock containing those names and
            pass --lockfile.
        empty_why: package names whose why dump is an empty file.
        custom_why: optional {name: raw_why_text} overriding why file contents.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            why_dir = root / "why"
            why_dir.mkdir()
            advisories = [{
                "ghsa_id": "GHSA-test",
                "packages": [
                    {"name": name, "patched": "2.0.0", "vulnerable_range": "< 2.0.0"}
                    for name in packages
                ],
            }]
            (root / "advisories.json").write_text(json.dumps(advisories))
            (root / "pr.json").write_text(json.dumps({"title": title, "body": body}))
            why_versions = why_versions or {}
            custom_why = custom_why or {}
            for name in packages:
                if name in custom_why:
                    (why_dir / f"{name}.txt").write_text(custom_why[name])
                    continue
                if name in empty_why:
                    (why_dir / f"{name}.txt").write_text("")
                    continue
                ver = why_versions.get(name, "1.0.0")
                version = f"{name}@npm:{ver}"
                if colored:
                    version = f"\x1b[34m{version}\x1b[0m"
                (why_dir / f"{name}.txt").write_text(version + "\n")
            output = root / "verification.json"
            cmd = [
                sys.executable, str(SCORER), "--advisories",
                str(root / "advisories.json"),
                "--why-dir", str(why_dir), "--pr-context", str(root / "pr.json"),
                "--workspace", "example", "--out", str(output),
            ]
            if lockfile_packages is not None:
                lines = []
                for name in lockfile_packages:
                    lines.append(f'"{name}@npm:^1.0.0":\n  version: 1.0.0\n')
                lock_path = root / "yarn.lock"
                lock_path.write_text("".join(lines))
                cmd.extend(["--lockfile", str(lock_path)])
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            return json.loads(output.read_text())

    def test_ansi_colored_yarn_why_versions_are_scored(self):
        result = self.score("CVE bump", "", ["axios"], colored=True)
        self.assertEqual(result["packages"][0]["versions"], ["1.0.0"])
        self.assertEqual(result["packages"][0]["status"], "fail")

    def test_extract_versions_expects_plain_text(self):
        colored = "\x1b[34maxios@npm:1.2.3\x1b[0m"
        self.assertEqual(
            self.score_mod.extract_versions(colored, "axios"),
            [],
        )
        plain = self.score_mod.strip_ansi(colored)
        self.assertEqual(
            self.score_mod.extract_versions(plain, "axios"),
            ["1.2.3"],
        )

    def test_partial_and_unchanged_tables_from_cve_bump_report(self):
        result = self.score(
            "CVE bump",
            "## Fully fixed\n| package | before | after | CVEs cleared |\n"
            "| --- | --- | --- | --- |\n| handlebars | 1.0.0 | 2.0.0 | GHSA-test |\n"
            "## Partial leftovers\n| package | before | after | remaining |\n"
            "| --- | --- | --- | --- |\n| fast-xml-parser | 1.0.0 | 1.0.0 | 1.0.0 |\n"
            "## Unchanged\n| package | before | after | remaining |\n"
            "| --- | --- | --- | --- |\n| lodash | 1.0.0 | 1.0.0 | 1.0.0 |\n",
            ["fast-xml-parser", "handlebars", "lodash"],
        )
        self.assertEqual(result["leftover_packages"], ["fast-xml-parser", "lodash"])
        self.assertEqual(
            {entry["package"]: entry["status"] for entry in result["packages"]},
            {"fast-xml-parser": "partial", "handlebars": "fail", "lodash": "partial"},
        )

    def test_table_header_words_are_not_packages(self):
        """Structural header skip: before/after/version never enter leftovers."""
        _, pkgs, listed = self.score_mod.documented_leftovers(
            "CVE bump",
            "## Partial leftovers\n"
            "| before | after | version | status |\n"
            "| --- | --- | --- | --- |\n"
            "| axios | 1.0.0 | 1.0.0 | open |\n",
            known_packages={"before", "after", "version", "status", "axios"},
        )
        self.assertTrue(listed)
        self.assertEqual(pkgs, {"axios"})
        # Header-only table contributes nothing.
        _, empty, listed_empty = self.score_mod.documented_leftovers(
            "CVE bump",
            "## Partial leftovers\n"
            "| before | after | version | status |\n"
            "| --- | --- | --- | --- |\n",
            known_packages={"before", "after", "version", "status"},
        )
        self.assertFalse(listed_empty)
        self.assertEqual(empty, set())

    def test_filtered_leftover_does_not_mark_other_vulnerabilities_partial(self):
        result = self.score(
            "[PARTIAL] CVE bump",
            "## Partial leftovers\n| package | remaining |\n| --- | --- |\n"
            "| unrelated-pkg | 1.0.0 |\n",
            ["axios"],
        )
        self.assertEqual(result["leftover_packages"], [])
        self.assertEqual(result["packages"][0]["status"], "fail")

    def test_partial_title_without_list_keeps_existing_fallback(self):
        result = self.score("[PARTIAL] CVE bump", "No leftover list.", ["axios"])
        self.assertEqual(result["packages"][0]["status"], "partial")

    def test_prose_and_bullets_are_not_leftovers(self):
        """Intentional: only tables count; prose/bullets stay fail without [PARTIAL]."""
        result = self.score(
            "CVE bump",
            "## Partial leftovers\n\n- lodash remains vulnerable\n"
            "axios is still unresolved after the bump.\n",
            ["axios", "lodash"],
        )
        self.assertEqual(result["leftover_packages"], [])
        self.assertEqual(
            {entry["package"]: entry["status"] for entry in result["packages"]},
            {"axios": "fail", "lodash": "fail"},
        )

    def test_empty_yarn_why_is_not_installed_pass(self):
        result = self.score(
            "CVE bump", "", ["vite-plus"], empty_why=("vite-plus",),
        )
        self.assertEqual(result["packages"][0]["status"], "pass")
        self.assertIn("Not installed", result["packages"][0]["detail"])
        self.assertEqual(result["status"], "pass")

    def test_advisory_sibling_missing_from_lockfile_is_pass(self):
        """launch-editor patched; vite/vite-plus on same GHSA but not in lockfile."""
        result = self.score(
            "CVE bump",
            "",
            ["launch-editor", "vite", "vite-plus"],
            why_versions={"launch-editor": "2.14.2"},
            lockfile_packages=["launch-editor"],
            empty_why=("vite", "vite-plus"),
        )
        by_pkg = {e["package"]: e for e in result["packages"]}
        self.assertEqual(by_pkg["launch-editor"]["status"], "pass")
        self.assertEqual(by_pkg["vite"]["status"], "pass")
        self.assertIn("Not in lockfile", by_pkg["vite"]["detail"])
        self.assertEqual(by_pkg["vite-plus"]["status"], "pass")
        self.assertEqual(result["status"], "pass")
        self.assertEqual(
            result["packages_not_in_lockfile"], ["vite", "vite-plus"],
        )

    def test_in_lockfile_empty_why_is_error(self):
        """Package in lockfile but empty yarn why → error (do not greenwash)."""
        result = self.score(
            "CVE bump",
            "",
            ["axios"],
            lockfile_packages=["axios"],
            empty_why=("axios",),
        )
        self.assertEqual(result["packages"][0]["status"], "error")
        self.assertIn("empty yarn why", result["packages"][0]["detail"])
        self.assertEqual(result["status"], "error")

    def test_unparseable_nonempty_why_still_errors(self):
        """ANSI/noise without strip path: non-empty unparseable stays error."""
        result = self.score(
            "t",
            "",
            ["axios"],
            lockfile_packages=["axios"],
            # Non-empty garbage that VERSION_RE will not match (and no ANSI
            # strip recovery because there is no @npm: token).
            custom_why={"axios": "Package tree unavailable\n"},
        )
        self.assertEqual(result["packages"][0]["status"], "error")
        self.assertEqual(result["status"], "error")

    def test_package_in_yarn_lock_helper(self):
        lock = '"launch-editor@npm:^2.6.0":\n  version: 2.14.1\n"@scope/pkg@npm:1.0.0":\n  version: 1.0.0\n'
        self.assertTrue(self.score_mod.package_in_yarn_lock(lock, "launch-editor"))
        self.assertTrue(self.score_mod.package_in_yarn_lock(lock, "@scope/pkg"))
        self.assertFalse(self.score_mod.package_in_yarn_lock(lock, "vite"))
        self.assertFalse(self.score_mod.package_in_yarn_lock(lock, "vite-plus"))


if __name__ == "__main__":
    unittest.main()
