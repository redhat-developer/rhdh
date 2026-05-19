# patch-backstage workflow (Mermaid)

Companion diagram for [`SKILL.md`](./SKILL.md). Render in GitHub, GitLab, VS Code (Mermaid preview), or docs tooling.

## Overview

One flow: **maintenance fork** produces **`dist/`**; **RHDH** pins that onto the **lockfile version** with **`yarn patch`**. Upstream **backstage/backstage** is only needed to **fetch** commit objects for cherry-pick / `git show` (optional).

```mermaid
flowchart TB
  subgraph repos["Repos"]
    direction LR
    U(["backstage/backstage<br/><i>optional: source of commits to cherry-pick if provided</i>"])
    M(["redhat-developer/backstage<br/>patch/release-V<br/><i>do manual fixes/cherry-picks onto and run yarn build to generate dist/</i>"])
    R(["redhat-developer/rhdh<br/>release-V<br/><i>run yarn why/patch/patch-commit, update lockfile, verify patch resolutions</i>"])
  end

  subgraph work["Workflow"]
    direction TB
    P[Pre-flight: clean trees, map git remotes] --> S1[Sync RHDH core repo → release-V branch]
    S1 --> S2[Sync maintenance repo → patch/release-V branch]
    S2 --> S3{Bring fix onto maintenance repo}
    S3 -->|Provided upstream SHAs| CP[cherry-pick or skip if changes already present in branch]
    S3 -->|manual edits| ME[direct changes in code]
    CP --> B[yarn build per package/plugin to generate dist/]
    ME --> B
    B --> RHDH[yarn why → yarn patch @npm:VERSION → copy dist → patch-commit]
    RHDH --> I[yarn install]
    I --> V[Verify yarn.lock + yarn why to confirm patch application]
  end
```

Step-by-step detail, troubleshooting, and **dynamic-plugins** (second Yarn project) are in [`SKILL.md`](./SKILL.md).
