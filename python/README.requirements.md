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
