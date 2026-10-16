#!/usr/bin/env python3
"""PROTOTYPE — summarize scriptc coverage ladder into triage + READINESS."""
from __future__ import annotations

import re
import sys
from pathlib import Path


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "out-coverage")
    triage_rows: list[tuple] = []

    for p in sorted(out.glob("*.coverage.txt")):
        text = p.read_text(errors="replace")
        label = p.name.replace(".coverage.txt", "")
        if "not analyzable" in text:
            errs = sorted(set(re.findall(r"error (SC\d+):", text)))
            triage_rows.append(
                (label, "NOT_ANALYZABLE", errs, text.splitlines()[:8])
            )
            continue
        static = re.search(r"compile statically\s+(\d+)\s+\((\d+)%\)", text)
        dynamic = re.search(r"compile dynamically\s+(\d+)\s+\((\d+)%\)", text)
        codes = sorted(set(re.findall(r"\b(SC\d+)\b", text)))
        st = static.groups() if static else ("?", "?")
        dy = dynamic.groups() if dynamic else ("0", "0")
        builds = ("builds with --dynamic" in text) or ("fully static" in text)
        # remaining blockers section means not clean
        has_blockers = bool(re.search(r"^\s*blockers:\s*$", text, flags=re.M))
        kind = "OK" if builds and not has_blockers else "HAS_FINDINGS"
        triage_rows.append((label, kind, st, dy, codes[:40]))

    lines: list[str] = [
        "PROTOTYPE scriptc coverage triage",
        "=================================",
        "",
    ]
    for row in triage_rows:
        label, kind = row[0], row[1]
        lines.append(f"## {label}")
        if kind == "NOT_ANALYZABLE":
            lines.append("status: NOT_ANALYZABLE (type errors gate coverage)")
            lines.append(f"errorCodes: {row[2]}")
            lines.append("head:")
            for h in row[3]:
                lines.append(f"  {h}")
        else:
            st, dy, codes = row[2], row[3], row[4]
            lines.append(f"status: {kind}")
            lines.append(f"static: {st[0]} ({st[1]}%)  dynamic: {dy[0]} ({dy[1]}%)")
            lines.append(
                f"SC codes ({len(codes)}): {', '.join(codes) if codes else '(none listed)'}"
            )
        lines.append("")

    def find(suffix: str):
        return next((t for t in triage_rows if t[0].endswith(suffix)), None)

    full = find("99-full-backend-index")
    dyn = find("05-with-dynamic-plugins")
    core = find("04-core-static-plugins")
    empty = find("02-create-backend-empty")
    health = find("03-create-backend-health")

    def status_of(row):
        return "missing" if row is None else row[1]

    ready: list[str] = [
        "PROTOTYPE readiness — full backend + dynamic plugins",
        "==================================================",
        "",
        "Question: Are we ready for a full-on PoC with dynamic plugins?",
        "",
        f"02 createBackend empty:         {status_of(empty)}",
        f"03 createBackend + health:      {status_of(health)}",
        f"04 core static plugins:         {status_of(core)}",
        f"05 with dynamic plugins:        {status_of(dyn)}",
        f"99 full packages/backend:       {status_of(full)}",
        "",
    ]

    reasons: list[str] = []
    for name, row in [
        ("createBackend empty", empty),
        ("core static plugins", core),
        ("dynamic-plugins rung", dyn),
        ("full backend index", full),
    ]:
        if row is None:
            reasons.append(f"{name}: no report")
        elif row[1] == "NOT_ANALYZABLE":
            reasons.append(
                f"{name}: blocked on TypeScript/resolution before coverage numbers"
            )
        elif row[1] != "OK":
            reasons.append(
                f"{name}: coverage has findings/blockers — not a clean --dynamic build"
            )
        else:
            reasons.append(
                f"{name}: coverage claims buildable with --dynamic (not runtime-proven)"
            )

    reasons.append(
        "dynamic plugins require runtime CommonJS module loading from disk; "
        "scriptc embeds deps at build time and does not load node_modules at runtime — "
        "true dynamicPluginsFeatureLoader behavior needs a redesign "
        "(prebundle plugins at build time or an external host), not just coverage green"
    )

    if (
        full
        and full[1] == "OK"
        and dyn
        and dyn[1] == "OK"
        and core
        and core[1] == "OK"
    ):
        verdict = (
            "NOT YET — coverage may look buildable, but runtime dynamic loading "
            "is still an architectural gap"
        )
    else:
        verdict = "NO"

    ready.append(f"Verdict: {verdict}")
    ready.append("")
    ready.append("Reasons:")
    for r in reasons:
        ready.append(f"- {r}")
    ready.append("")
    ready.append(
        "Next compile target if pursuing backend-like PoC without true dynamic plugins:"
    )
    ready.append("- Get 04-core-static-plugins analyzable + buildable")
    ready.append("- Ship that as the backend-like image twin")
    ready.append("- Treat dynamic plugins as a separate design spike")

    (out / "triage.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "READINESS.txt").write_text("\n".join(ready) + "\n", encoding="utf-8")
    print("\n".join(ready))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
