"""
Safe removal of support:/lifecycle: keywords from dynamic plugins' package.json files.

Behavior:
- Runs a pre-flight consistency check against marketplace YAML files.
- If any package has mismatched lifecycle/support or a missing YAML, aborts with a report.
- Otherwise, removes only support:/lifecycle: keywords.

Usage:
  python scripts/remove_keywords_from_package_json.py --yes        # actually modify files
  python scripts/remove_keywords_from_package_json.py              # dry run (no changes)

Assisted-by: Cursor
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List


def find_wrapper_package_json_files(repo_root: Path) -> List[Path]:
    wrappers_dir = repo_root / "dynamic-plugins" / "wrappers"
    package_files: List[Path] = []
    for item in wrappers_dir.iterdir():
        if item.is_dir():
            package_json = item / "package.json"
            if package_json.exists():
                package_files.append(package_json)
    return package_files


def load_json(path: Path) -> dict:
    with open(path, "r") as f:
        return json.load(f)


def save_json(path: Path, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def run_preflight_check(repo_root: Path, verbose: bool = False) -> int:
    """Use the existing checker to ensure there are no mismatches or missing YAML files.

    Returns the number of problems found (mismatch + missing YAML).
    """
    # Ensure we can import the checker from scripts/
    scripts_dir = repo_root / "scripts"
    sys.path.insert(0, str(scripts_dir))
    try:
        from check_package_yaml_consistency import PackageYamlChecker  # type: ignore
    except Exception as imp_err:  # pragma: no cover
        print(f"Error: unable to import PackageYamlChecker: {imp_err}")
        return 1

    checker = PackageYamlChecker(str(repo_root))
    checker.check_consistency()

    problems = [r for r in checker.results if r["status"] in ("MISMATCH", "NO_YAML")]
    if problems:
        print("\n========== ABORTING: Pre-flight check failed ==========")
        mismatch_count = len([p for p in problems if p["status"] == "MISMATCH"])
        no_yaml_count = len([p for p in problems if p["status"] == "NO_YAML"])
        print(f"❌ Inconsistent packages: {mismatch_count}")
        print(f"⚠️ Missing marketplace catalog entity files: {no_yaml_count}")
        print("Fix the above issues before removing keywords.")
        print("\nTo fix these issues:")
        print("1. Run the consistency checker to see details: python scripts/check_package_yaml_consistency.py")
        print("2. Create missing YAML files or fix mismatches")
        print("3. Re-run this script")
        
    else:
        if verbose:
            print("✅ Pre-flight check passed: no inconsistencies or missing marketplace catalog entity files found.")

    return len(problems)


def list_safe_wrapper_dirs(repo_root: Path) -> list[str]:
    scripts_dir = repo_root / "scripts"
    sys.path.insert(0, str(scripts_dir))
    from check_package_yaml_consistency import PackageYamlChecker  # type: ignore
    checker = PackageYamlChecker(str(repo_root))
    checker.check_consistency()
    safe: list[str] = []
    for r in checker.results:
        if r.get("status") == "OK" and r.get("json_path"):
            safe.append(str(Path(r["json_path"]).parent.relative_to(repo_root)))
    return sorted(safe)


def format_all_wrapper_json(repo_root: Path) -> int:
    """Re-save all wrapper package.json files with normalized formatting."""
    formatted = 0
    for package_json_path in find_wrapper_package_json_files(repo_root):
        try:
            data = load_json(package_json_path)
        except Exception:
            continue
        save_json(package_json_path, data)
        formatted += 1
    return formatted

def remove_support_lifecycle_keywords(repo_root: Path, dry_run: bool, verbose: bool) -> int:
    """Remove support:/lifecycle: keywords across wrappers. Returns count of modified files."""
    modified = 0
    for package_json_path in find_wrapper_package_json_files(repo_root):
        try:
            data = load_json(package_json_path)
        except Exception as e:
            if verbose:
                print(f"Skipping {package_json_path}: failed to parse JSON ({e})")
            continue

        keywords = list(data.get("keywords", []))
        if not keywords:
            continue

        kept = []
        removed = []
        for kw in keywords:
            if isinstance(kw, str) and (kw.startswith("support:") or kw.startswith("lifecycle:")):
                removed.append(kw)
            else:
                kept.append(kw)

        if not removed:
            continue

        if verbose:
            print(f"\n{package_json_path}")
            print(f"  Removed: {removed}")
            if kept:
                print(f"  Kept:    {kept}")
            else:
                print("  Kept:    [] (keywords will be removed entirely)")

        if not dry_run:
            if kept:
                data["keywords"] = kept
            else:
                data.pop("keywords", None)
            save_json(package_json_path, data)
            modified += 1

    return modified


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Safely remove support:/lifecycle: keywords from package.json files")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be changed without making changes")
    parser.add_argument("--yes", action="store_true", help="Apply changes (not a dry run)")
    parser.add_argument("--list-safe", action="store_true",
                        help="Print wrapper directories that passed preflight (OK) and exit")
                        #added in case we want to format the package.json files without removing the keywords
    parser.add_argument("--format-only", action="store_true",
                        help="Re-save all wrapper package.json with normalized formatting and exit")
    parser.add_argument("--verbose", action="store_true", help="Print detailed per-file output")
    args = parser.parse_args()

    if args.list_safe:
        for d in list_safe_wrapper_dirs(repo_root):
            print(d)
        return

    if args.format_only:
        modified = 0
        for package_json_path in find_wrapper_package_json_files(repo_root):
            try:
                data = load_json(package_json_path)
            except Exception as e:
                if args.verbose:
                    print(f"Skipping {package_json_path}: failed to parse JSON ({e})")
                continue
            save_json(package_json_path, data)
            modified += 1
        if args.verbose:
            print(f"\n✅ Formatting complete. Files re-saved: {modified}")
        return

    # Always normalize JSON formatting by default
    formatted = format_all_wrapper_json(repo_root)
    # No console noise for routine formatting

    problems = run_preflight_check(repo_root, verbose=args.verbose)
    if problems:
        sys.exit(1)

    modified = remove_support_lifecycle_keywords(repo_root, dry_run=not args.yes, verbose=args.verbose)
    if args.yes:
        print(f"\n✅ Done. Files modified: {modified}")
        if args.verbose:
            print(f"\n💡 Note: YAML files in catalog-entities/marketplace/packages/ are now")
            print(f"   the single source of truth for support and lifecycle metadata.")
    else:
        print(f"\nℹ️ Dry run complete. Files that would be modified: {modified}")


if __name__ == "__main__":
    main()
