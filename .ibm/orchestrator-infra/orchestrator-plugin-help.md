# :wave: Need help enabling **Orchestrator** plugins on RHDH

_Chart / Image_

```
chart: quay.io/rhdh/chart 1.7-154-CI
image: quay.io/redhat-developer-hub/rhdh-hub-rhel9:1.7-154-CI
namespace: rhdh-ci
```

_What I tried_

1. `@redhat/backstage-plugin-orchestrator@1.7.1` + integrity → npm 404
2. Path to dist dir `./dynamic-plugins/dist/backstage-plugin-orchestrator` → ENOENT (no
   package.json)
3. Path to tgz `./dynamic-plugins/dist/backstage-plugin-orchestrator-backend-dynamic-1.7.1.tgz` →
   tarball corrupted / ENOENT
4. Combos of the above (with/without integrity) → same errors

Installer always ends with:

```text
Error while installing plugin … with 'npm pack'
npm error enoent Could not read package.json …
```

Anyone know the correct reference for the Orchestrator tarballs **in this image** or a flag to skip
`npm pack`?

Thanks! :pray:
