# To iteratively add/fix requirements:

Add more to, or update existing dependencies in, the `requirements.in`, then:

```
pip-compile --allow-unsafe --strip-extras requirements.in -o requirements.txt
```

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
cd /tmp; curl -sSLO https://raw.githubusercontent.com/containerbuildsystem/cachito/refs/heads/master/bin/pip_find_builddeps.py && chmod +x pip_find_builddeps.py; cd -
/tmp/pip_find_builddeps.py requirements.txt -o requirements-build.in --append --no-cache
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

To test in Konflux, using something like:

```
pip3.11 install --user --no-cache-dir -r requirements.txt -r requirements-build.txt
```

- commit changes to midstream (gitlab) repo, in a specific branch like [add-pip-deps](https://gitlab.cee.redhat.com/rhidp/rhdh/-/commits/add-pip-deps)
- submit an MR which includes a change to the the `max-keep-runs` value of the https://gitlab.cee.redhat.com/rhidp/rhdh/-/blob/rhdh-1-rhel-9/.tekton/rhdh-hub-1-pull-request.yaml#L9 file - this will ensure the PR triggers a build in Konflux.

If the build fails, add more dependencies to the requirements file, and try again.

When the build passes, commit changes to upstream repo, and trigger sync to cause a midstream/downstream build to verify your changes.

Note that some files are transformed between up/mid/downstream, so you may have to apply changes in more than one file.

- Upstream: `docker/Dockerfile` (upstream) and `.rhdh/docker/Dockerfile` (midstream)

- Midstream is transformed to `distgit/containers/rhdh-hub/Containerfile` via [sync-midstream.sh](https://gitlab.cee.redhat.com/rhidp/rhdh/-/blob/rhdh-1-rhel-9/build/ci/sync-midstream.sh)
