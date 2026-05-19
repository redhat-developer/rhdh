---
name: patch-backstage
description: Workflow to backport Backstage changes into RHDH by syncing a downstream maintenance branch and generating yarn patches.
---
# RHDH Patch Generator

## Purpose

Ship a fix on an RHDH **`release-*`** line **without** bumping published Backstage versions by adding **Yarn patches** (`.yarn/patches/`, `package.json` **`resolutions`**, lockfiles).

- **`COMMITS`:** SHAs on **[backstage/backstage](https://github.com/backstage/backstage)** that are on **`master`** (merged fixes). Fetch **`master`** from **`BACKSTAGE_UPSTREAM_REMOTE`** so those objects exist in the **maintenance** clone for **`git show`** / cherry-pick.
- **Build source:** **redhat-developer/backstage** at **`patch/release-<VERSION>`** only (not a separate upstream checkout).
- **Cherry-pick** those SHAs onto maintenance **only** if the **pre-check** shows maintenance source still differs; otherwise **build + patch RHDH** only.

## Repos

| Repo | Role |
|------|------|
| **redhat-developer/rhdh** | Patches live here. Sync **`release-<VERSION>`**; run **`yarn patch`** here (root and/or **`dynamic-plugins/`**). |
| **redhat-developer/backstage** | Maintenance fork: **`patch/release-<VERSION>`**, optional cherry-pick, **`yarn build`** per package **`cd`**, copy **`dist/`** into RHDH patch temps. PRs from your fork. |
| **backstage/backstage** | Upstream object source only: remote on the **same** maintenance clone, **`git fetch`** for **`COMMITS`**. **Do not** use a second upstream checkout as the build tree. |

## Parameters

| Name | Required | Notes |
|------|----------|--------|
| **`RHDH_VERSION`** | Yes | e.g. `1.9` → **`release-1.9`**, **`patch/release-1.9`**. Do not infer from the current branch. |
| **`RHDH_ROOT`** | No | Absolute path to the RHDH repo root (appears as **`<RHDH_ROOT>`** in examples). Inferred from context if omitted. |
| **`COMMITS`** | Typical | Upstream SHAs (oldest first for cherry-pick). If no SHAs, manual **`dist`** / patch only. |
| **`PACKAGES`** | If unclear | `@backstage/...` names. Derive from **`COMMITS`** (below) when paths map cleanly. |

**Path map:** `@backstage/plugin-<id>` → **`plugins/<id>/`**; other **`@backstage/<id>`** → **`packages/<id>/`**.

### Deriving **`PACKAGES`** from **`COMMITS`**

In the **maintenance** clone, after **`git fetch <BACKSTAGE_UPSTREAM_REMOTE> master`** so **`COMMITS`** exist locally: **`git show --name-only --pretty=format: <SHA>`** (union for multiple SHAs). Map **`plugins/*`** and **`packages/*`** roots; read each **`package.json`** **`name`**; dedupe. Ignore-only changes (root lockfile, **`.changeset/`**, **`docs/`**, version-only **`package.json`**) → ask which packages to patch.

**Example:** `66e08b08f94a31cbf28b416c89b61549bc3b64a2` → **`@backstage/cli-common`**, **`@backstage/backend-plugin-api`**, **`@backstage/plugin-techdocs-node`**.

## Git remotes, hooks, and where this skill file lives

**Map remotes by URL** in **each** clone (`git remote -v`); never assume **`upstream`** means a given org.

- **RHDH core** (`release-*`): URL **redhat-developer/rhdh** → **`RHDH_CORE_REMOTE`**.
- **Maintenance Backstage** (`patch/release-*`, fork push): URL **redhat-developer/backstage** + usually your fork as **`origin`**.
- **Upstream Backstage** (fetch **`COMMITS`** only): URL **backstage/backstage** → **`BACKSTAGE_UPSTREAM_REMOTE`**.

Exact maintenance tip:  
`git fetch https://github.com/redhat-developer/backstage.git patch/release-<RHDH_VERSION>`  
then **`HUSKY=0 git checkout -B patch/release-<RHDH_VERSION> FETCH_HEAD`** when Husky would otherwise run on checkout.

**Silencing hooks:** For branch sync only (Steps 1–2: fetch/checkout/pull/**`checkout -B`**, and **`git cherry-pick`** when you are not relying on hook side effects), prefix with **`HUSKY=0`**. Omit **`HUSKY=0`** on **`git commit`** if you want **lint-staged** locally.

```bash
cd <RHDH_ROOT> && HUSKY=0 git fetch <RHDH_CORE_REMOTE> release-<V> && HUSKY=0 git checkout release-<V> && HUSKY=0 git pull <RHDH_CORE_REMOTE> release-<V>
```

**Rulesync:** Edit **`SKILL.md` only** under **`.rulesync/skills/patch-backstage/`** (rulesync expects **one directory per skill** with **`SKILL.md`** inside; a flat **`*.md`** at **`skills/`** root is ignored). With **`"skills"`** and **`"simulateSkills": true`** in **`rulesync.jsonc`**, **`yarn rulesync:generate`** writes **both** **`.claude/skills/`** and **`.cursor/skills/`** from that tree (rulesync treats Cursor skill output as “simulated”). Stage and commit generated paths with **`.rulesync/`** after edits.

## Agent execution

- **Batch** related shell commands with **`&&`** and **`cd <RHDH_ROOT>`**; cwd may not persist between tool calls. Use **`network` / `git_write` / `all`** as needed (**`all`** for **`rm`/`cp`** into Yarn patch temps or stubborn sandboxes).
- **Stop and ask** when **`RHDH_VERSION`**, **`COMMITS`**, clone paths, or workspace ownership is missing or ambiguous—not for a second confirmation when the user already asked for **yarn patches** for given SHAs (see **Pre-check → patch-only**).
- **Do not** invent remotes or wander with speculative **`find`**; **do** run steps this doc names (**`git remote -v`**, **`yarn why`**, etc.).

## Dist baseline

- **`yarn patch`** overlays **`dist/`** on the **version RHDH already resolves** (lockfile), so **`PACKAGE_VERSION`** must come from **`yarn why`**, not from “what Backstage released.”
- **Compile only** on **redhat-developer/backstage** **`patch/release-<RHDH_VERSION>`** after fetching that ref from **redhat-developer** (local/fork tips can diverge by name).
- **Do not** build from **backstage/backstage** release tags or other upstream checkouts to “match” versions unless this workflow is explicitly extended.

## Workflow (overview)

1. **Pre-flight:** Clean trees and remotes (**Step 1** opening + **Git remotes**); set **`RHDH_CORE_REMOTE`**, **`BACKSTAGE_UPSTREAM_REMOTE`**, optional **`FORK_REMOTE`** (your Backstage fork for PRs).
2. **RHDH:** **`HUSKY=0`** fetch/checkout/pull **`release-<RHDH_VERSION>`**.
3. **Maintenance:** Fetch **`patch/release-*`** from redhat-developer; **`HUSKY=0 checkout -B`**; **`git fetch <BACKSTAGE_UPSTREAM_REMOTE> master`** (upstream integration branch for **`COMMITS`**); **pre-check**; cherry-pick **or** patch-only path; **`yarn build`** per **`PACKAGES`** (**`cd` + `yarn build`**, not root **`yarn workspace … build`**).
4. **RHDH:** Remove stale **`.patch`** + **`resolutions`** for targets; **`yarn why`** → versions; **`yarn patch`** / replace **`dist`** / **`patch-commit`**; **clean up `resolutions`**; **`yarn install`** (root and **`dynamic-plugins/`** as needed).
5. **Verify:** **`@patch:`** in each relevant **`yarn.lock`**; **`yarn why`** shows **`via patch:`**; commit artifacts.

---

## Step 1: Sync RHDH

**Pre-flight (both repos):** **`git status`** clean in **RHDH** and the **maintenance** Backstage clone (stash WIP or **`git merge --abort`** / **`git rebase --abort`** as needed). Do not run the workflow mid-conflict.

1. **`git remote -v`** → **`RHDH_CORE_REMOTE`** = remote for **redhat-developer/rhdh**.
2. **`HUSKY=0 git fetch … release-<RHDH_VERSION>`** && **`HUSKY=0 git checkout …`** && **`HUSKY=0 git pull …`**. Fail if the branch is missing.
3. Set **`MAINTENANCE_BRANCH`** = **`patch/release-<RHDH_VERSION>`** (used when opening a Backstage PR).

## Step 2: Maintenance clone

**One** clone with **redhat-developer/backstage** + **backstage/backstage** remotes.

### 2.1 Sync `patch/release-*`

```bash
git fetch https://github.com/redhat-developer/backstage.git patch/release-<RHDH_VERSION> \
  && HUSKY=0 git checkout -B patch/release-<RHDH_VERSION> FETCH_HEAD
```

Then **`git fetch <BACKSTAGE_UPSTREAM_REMOTE> master`**. **backstage/backstage** lands merged work on **`master`**; **`COMMITS`** should be reachable from **`master`**. **Do not** check out upstream as the build tree.

### 2.2 Pre-check (skip cherry-pick when source already matches)

For each SHA in **`COMMITS`** (oldest first):

1. **`git show --name-only --pretty=format: <SHA>`**
2. **Drop** bookkeeping-only paths: root **`package.json`**, **`CHANGELOG.md`**, package **`package.json`** version-only edits, **`.changeset/`**, **`docs/`**, lockfiles, etc. **Keep** **`src/`**, tests, fixtures tied to the fix.
3. **`git diff <SHA> HEAD -- <kept paths>`** (union paths if multiple SHAs).

**Empty diff** → maintenance already has the functional fix; **do not cherry-pick** (avoids changelog/version noise).

### 2.3 Patch-only vs ask

- **Proceed** without extra confirmation if the user already asked for **yarn patches** for **`COMMITS`** on this **`release-*`**: empty pre-check → go to **2.6 Build** and RHDH Steps 3–5; note in the **Final summary** that cherry-pick was skipped.
- **Ask** if intent is vague (“sync Backstage” only) or they may want a **maintenance PR** for traceability despite identical source.

### 2.4 Cherry-pick (when pre-check was non-empty)

**`git cherry-pick <SHA>`** (oldest first) onto **`patch/release-*`**.

**Conflicts:** Prefer the **cherry-picked commit’s** content for conflicted **`src/`** (during cherry-pick, **`git checkout --theirs -- <path>`** refers to that commit). If fixing conflicts would drop the functional fix, or conflicts are only **changelog/version** noise you should not merge, **`git cherry-pick --abort`**, note it in the **Final summary**, and coordinate with the user. Do not push a broken maintenance branch.

### 2.5 Push maintenance (optional)

Push to **`FORK_REMOTE`** and open a PR to **redhat-developer/backstage** base **`MAINTENANCE_BRANCH`** (no direct push to **redhat-developer**).

### 2.6 Build **`PACKAGES`**

For each package: **`cd`** **`plugins/<id>/`** or **`packages/<id>/`** → **`yarn build`**. If **`dist-types`** or build fails: maintenance repo root **`yarn install`** / **`yarn tsc`**, then retry per-package **`yarn build`**.

## Step 3: Prepare RHDH

**`dynamic-plugins/`** is a **separate** Yarn project: its **`yarn.lock`** and **`resolutions`** are independent of the root.

1. Remove prior **`.patch`** files and matching **`resolutions`** entries for the packages you are refreshing (search **both** root and **`dynamic-plugins/package.json`**).
2. **`yarn why @backstage/<pkg>`** from **RHDH root**; if empty, run from **`dynamic-plugins/`**. Record **PACKAGE_VERSION** for Step 4.

## Step 4: Generate patches

Run from **RHDH root** or **`dynamic-plugins/`** depending on where the dependency resolves.

**Temp folder:** Each **`yarn patch …`** prints a **new** path—use it immediately for **`rm`**, **`cp`**, **`yarn patch-commit -s`** (same shell or paste path). Do not reuse an old temp. Sandboxes may need **`all`** for **`cp`** into system temp.

**Per package:**

1. **`yarn patch <package>@npm:<PACKAGE_VERSION>`**
2. **`rm -rf <PATCH_TEMP>/dist`** && **`cp -r <backstage-clone>/<plugins|packages>/.../dist <PATCH_TEMP>/dist`**
3. **`yarn patch-commit -s <PATCH_TEMP>`** in that workspace.

If a package resolves in **both** trees at the **same** version, patch **both** places (or mirror the **`patch:`** resolution into **`dynamic-plugins/package.json`** and run **`yarn install`** there too).

### After **`yarn patch-commit`** (cleanup — required)

1. **Replace** any bare **`"@backstage/foo": "1.2.3"`** in **`resolutions`** with the **single** **`patch:`** locator Yarn printed—**do not** leave bare semver beside new patch keys (patch may not apply; Step 5 will show plain **`@npm:`**).
2. **Delete** spurious range keys **`patch-commit`** added (e.g. **`@backstage/foo@^1.6.0`** → patch built from **`@npm:1.5.0`**), which mis-resolve other workspaces (**`dynamic-plugins/`** may need **`@backstage/backend-plugin-api@1.6.0`** untouched by root).
3. **Install:** **`yarn install`** at root and/or **`dynamic-plugins/`**;

## Step 5: Verify (required)

Incomplete until every patched package shows a **patch locator** in **`yarn.lock`** and **`yarn why`**.

1. **`yarn install`** in each touched project.
2. **`grep '@backstage/<pkg>@patch' yarn.lock`** (run inside **`dynamic-plugins/`** for packages resolved only there).
3. **`yarn why @backstage/<pkg>`** in the same directory: must include **`via patch:`** / **`@…@patch:`**, not only **`via npm:<version>`**.

**Optional:** Spot-check **`node_modules/@backstage/<pkg>/dist/`**.

**Commit:** **`.yarn/patches/*.patch`**, **`package.json`** **`resolutions`**, **`yarn.lock`** (root and/or **`dynamic-plugins/`**); PR to RHDH.

### Final summary

1. Links: `https://github.com/backstage/backstage/commit/<SHA>` for each **`COMMITS`** entry.
2. **`PACKAGES`**, patch locations (root vs **`dynamic-plugins/`**), notable **`resolutions`** keys.
3. Cherry-pick skipped vs applied; conflicts/aborts if any.
4. **`MAINTENANCE_BRANCH`**, optional Backstage PR link; RHDH PR intent.
5. **`RHDH_VERSION`**.

## Safety

- Do not invent **`patch/release-*`** if missing on **redhat-developer/backstage**.
- No blind conflict resolution on cherry-picks; no direct push to **redhat-developer** remotes without process.

## Common issues (quick reference)

| Symptom | What to do |
|---------|------------|
| Wrong maintenance tip | Fetch **`https://github.com/redhat-developer/backstage.git patch/release-<V>`**, **`checkout -B … FETCH_HEAD`** |
| **`bad object`** on cherry-pick / show | **`git fetch <BACKSTAGE_UPSTREAM_REMOTE> master`** |
| Checkout/pull fails after Yarn / Husky | **`HUSKY=0`** on those git commands |
| **`yarn why` / lockfile: no `@patch:`** | Remove bare semver **`resolutions`** for that pkg; use one **`patch:`** locator; drop wrong range keys; reinstall |
| Build fails (missing types) | Maintenance root **`yarn install`** / **`yarn tsc`**, then **`cd`** package **`yarn build`** |
| Patch wrong version | Use **`yarn why`** version, not RHDH meta-version |
| Skill not in Cursor | **`.rulesync/skills/`** may not sync to **`.cursor/`**—see **Rulesync / Cursor** |
