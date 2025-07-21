# To iteratively add/fix requirements:


## Testing locally using github sources

Add more to, or update existing dependencies in, the `requirements.in`.

You can also remove all the pinned versions, then:

```
pip-compile --allow-unsafe --strip-extras requirements.in -o requirements.txt
```

Try to install everything in `requirements.txt`:

```
rm -rf pyvenv.cfg lib* bin/*
virtualenv .; . bin/activate
pip install --upgrade pip; pip install -r requirements.txt
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
# plantuml-markdown==3.9.7
plantuml-markdown @ https://github.com/mikitex70/plantuml-markdown/archive/fcf62aa930708368ec1daaad8b5b5dbe1d1b2014.zip#cachito_hash=sha256:a487c2312a53fe47a0947e8624290b2c8ea51e373140d02950531966b1db5caa

# plantuml-markdown==3.11.1
plantuml-markdown @ https://github.com/mikitex70/plantuml-markdown/archive/592837e9c26b9e92d711af42bce8fb8697183f9d.zip#cachito_hash=sha256:adb7dd7f1aa90a0fdb279f3ad58ede6cdc9eb826adc9d1405b02d4491e492df0
```

## Testing locally with Hermeto

To validate your requirements files in an offline way, you can use Hermeto.

First, clone this repo if not already done

```# for github, check out this project to some folder:
git_repo=/path/to/cloned/redhat-developer/rhdh

# or for gitlab, check out the rhidp/rhdh project to some folder:
git_repo=/path/to/cloned/rhidp/rhdh
```

Next, regenerate the requirements*.txt files.

You may also want to remove any versions pinned to the .in files to see if the latest deps can work together.

```
# for github
path_to_python=python

# or for gitlab
path_to_python=distgit/containers/rhdh-hub/python

cd "$git_repo"
cd "$path_to_python"
rm -fr "./requirements"*.txt && \
pip-compile --output-file=requirements.txt --strip-extras requirements.in && \
pip-compile --output-file=requirements-build.txt --strip-extras requirements-build.in

# add the plantuml-markdown hash back in
hash=$(grep "plantuml-markdown @"  requirements.in) && \
sed -i requirements.txt -r -e "s|plantuml-markdown @.+|${hash}|" && \
sed -i requirements-build.txt -r -e "s|plantuml-markdown @.+|${hash}|"

cd -
```

Next, run Hermeto:

```
# "install" hermeto as a podman-run container:
alias hermeto='podman run --rm -ti -v "$PWD:$PWD:z" -w "$PWD" quay.io/konflux-ci/hermeto:latest'

# make sure you're running repo clone folder or Hermeto will get lost:
cd "$git_repo"

# fetch deps to see if anything breaks:
hermeto fetch-deps --source ${git_repo} --output /tmp/python-hermeto-github-output $(jq -c '.' ${git_repo}/python/hermeto_github.json)

# or for gitlab:
hermeto fetch-deps --source ${git_repo} --output /tmp/python-hermeto-gitlab-output $(jq -c '.' ${git_repo}/distgit/containers/rhdh-hub/python/hermeto_gitlab.json)
```

Should see something like this:

```
2025-07-14 14:49:25,691 INFO Found name in setup.py: 'Python dependencies'
2025-07-14 14:49:25,691 INFO Found version in setup.py: '1.0'
2025-07-14 14:49:25,691 INFO Resolved name Python dependencies for package at /home/nboldt/4/tmp70bz7pdq.hermeto-source-copy/distgit/containers/rhdh-hub/python
2025-07-14 14:49:25,691 INFO Resolved version 1.0 for package at /home/nboldt/4/tmp70bz7pdq.hermeto-source-copy/distgit/containers/rhdh-hub/python
...
2025-07-14 14:50:30,784 INFO All dependencies fetched successfully \o/
```

For more on Hermeto and pip, see https://github.com/hermetoproject/hermeto/blob/main/docs/pip.md

## Testing in Konflux using gitlab sources

To test in Konflux, repeat the above steps in the midstream (gitlab) repo, using something like:

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
