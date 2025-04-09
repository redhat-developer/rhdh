# To iteratively add/fix requirements:

Add more dependencies to `requirements.in`, then:

```
pip-compile --allow-unsafe --strip-extras requirements.in -o requirements.txt
```

If it passes, you can run `cachito_hash.sh` to fix the sha256sums.

Try to install everything in `requirements.txt`:

```
rm -rf pyvenv.cfg lib* bin/*
virtualenv .; . bin/activate
pip install -r requirements.txt
```

If it fails, repeat previous step to add more dependencies `requirements.in` and repeat.

Now, set up BUILD requirements, see https://github.com/containerbuildsystem/cachito/blob/master/docs/pip.md#build-dependencies to get `pip_find_builddeps.py`, then run:

```
rm -fr /tmp/pip_find_builddeps.py*
pip_find_builddeps.py requirements.txt -o requirements-build.in --append --no-cache
```

Review the contents of `requirements-build.in` to remove dupes. Then regenerate `requirements-build.txt`

```
pip-compile --allow-unsafe --strip-extras requirements-build.in -o requirements-build.txt
```

If it passes, you can run `cachito_hash.sh` to fix the sha256sums.

Finally, MAKE SURE YOU OVERRIDE what's in the .txt files to add in the cachito_hash values, as pip-compile will remove them. This can be done by running `cachito_hash.sh`.

```
mkdocs-techdocs-core @ https://github.com/backstage/mkdocs-techdocs-core/archive/bbdab44e0d3aecfdc4e77b14c72b57791d4902b2.zip#cachito_hash=sha256:40421a5f43b11fd9ea9f92e107f91089b6bfa326967ad497666ab5a451fcf136
plantuml-markdown @ https://github.com/mikitex70/plantuml-markdown/archive/fcf62aa930708368ec1daaad8b5b5dbe1d1b2014.zip#cachito_hash=sha256:a487c2312a53fe47a0947e8624290b2c8ea51e373140d02950531966b1db5caa
```

To test in a [container build](https://pkgs.devel.redhat.com/cgit/containers/rhdh-hub/tree/Dockerfile?h=private-nboldt-cachito-pip#n155) in Brew, using something like:

```
pip3.11 install --user --no-cache-dir -r requirements.txt -r requirements-build.txt
```

- commit changes to midstream (gitlab) repo, in a specific branch like [add-pip-deps](https://gitlab.cee.redhat.com/rhidp/rhdh/-/commits/add-pip-deps)
- collect the latest SHA for that branch
- create a topic branch in https://pkgs.devel.redhat.com/cgit/containers/rhdh-hub
- copy the above SHA into the container.yaml for the remote_source.ref values. For example: https://pkgs.devel.redhat.com/cgit/containers/rhdh-hub/commit/?h=private-nboldt-cachito-pip&id=dd6db447ee228be14f9de2c940b5e3efee4890e9
- run a [scratch build](https://gist.github.com/nickboldt/5b674f75934e7bba5a38486e17a18cfa) and wait for results.
- review cachito and build logs to see what happened.

If the build fails, add more dependencies to the requirements file, and try again.

When the build passes, commit changes to midstream and downstream, and trigger sync to cause a downstream build to verify your changes.

Note that some files are transformed between up/mid/downstream, so you may have to apply changes in more than one file.

- Upstream: `docker/Dockerfile` (upstream) and `.rhdh/docker/Dockerfile` (mid + downstream)

- Midstream: `distgit/containers/rhdh-hub/.rhdh/docker/Dockerfile` is transformed to `distgit/containers/rhdh-hub/Dockerfile.in` via [sync.sh](https://gitlab.cee.redhat.com/rhidp/rhdh/-/blob/rhdh-1.1-rhel-9/sync.sh)

- Downstream: `Dockerfile.in` becomes `Dockerfile` automatically, injecting the product version from [`gcp_env/product_version`](https://gitlab.cee.redhat.com/rhidp/rhdh/-/blob/rhdh-1.1-rhel-9/gcp_env/product-version)
