#!/usr/bin/env python3
#
# install-dynamic-plugins-fast.py
# High-performance rewrite of install-dynamic-plugins.py
#
# Key optimizations:
# 1. Parallel OCI downloads via ThreadPoolExecutor (auto-scales to CPU count)
# 2. Shared OCI image cache (one download per unique image, not per plugin)
# 3. Cached skopeo inspect results (no redundant network calls)
# 4. Batch tar extraction with filtered members
# 5. Integrity verification via hashlib (no subprocess openssl/cat pipeline)
# 6. Same input/output contract as the original script
#

import atexit
import base64
import binascii
import copy
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import StrEnum
from threading import Lock
from typing import Any

import yaml

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DOCKER_PROTO = "docker://"
OCI_PROTO = "oci://"
RHDH_REGISTRY = "registry.access.redhat.com/rhdh/"
RHDH_FALLBACK = "quay.io/rhdh/"
MAX_ENTRY_SIZE = int(os.environ.get("MAX_ENTRY_SIZE", 20_000_000))
RECOGNIZED_ALGORITHMS = ("sha512", "sha384", "sha256")


class PullPolicy(StrEnum):
    IF_NOT_PRESENT = "IfNotPresent"
    ALWAYS = "Always"


class InstallException(Exception):
    pass


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    print(msg, flush=True)


def run(cmd: list[str], err_msg: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True, cwd=cwd)
    except subprocess.CalledProcessError as e:
        parts = [f"{err_msg}: exit code {e.returncode}", f"cmd: {' '.join(e.cmd)}"]
        if e.stderr:
            parts.append(f"stderr: {e.stderr.strip()}")
        raise InstallException("\n".join(parts))


def get_workers() -> int:
    env = os.environ.get("DYNAMIC_PLUGINS_WORKERS", "auto")
    if env != "auto":
        return max(1, int(env))
    cpus = os.cpu_count() or 1
    # Conservative: half CPUs, cap at 6, floor at 1
    return max(1, min(cpus // 2, 6))


def deep_merge(src: dict, dst: dict, prefix: str = "") -> dict:
    for k, v in src.items():
        if isinstance(v, dict):
            deep_merge(v, dst.setdefault(k, {}), f"{k}.")
        else:
            if k in dst and dst[k] != v:
                raise InstallException(f"Config key '{prefix}{k}' defined differently for 2 dynamic plugins")
            dst[k] = v
    return dst


# ---------------------------------------------------------------------------
# Skopeo wrapper with caching
# ---------------------------------------------------------------------------

class Skopeo:
    """Thread-safe skopeo wrapper with inspect cache."""

    def __init__(self):
        self._path = shutil.which("skopeo")
        if not self._path:
            raise InstallException("skopeo not found in PATH")
        self._inspect_cache: dict[str, dict] = {}
        self._lock = Lock()

    def copy(self, src: str, dst: str) -> None:
        run([self._path, "copy", "--override-os=linux", "--override-arch=amd64", src, dst],
            f"skopeo copy failed: {src}")

    def inspect_raw(self, image_url: str) -> dict:
        with self._lock:
            if image_url in self._inspect_cache:
                return self._inspect_cache[image_url]
        result = run([self._path, "inspect", "--no-tags", "--raw", image_url],
                     f"skopeo inspect failed: {image_url}")
        data = json.loads(result.stdout)
        with self._lock:
            self._inspect_cache[image_url] = data
        return data

    def inspect(self, image_url: str) -> dict:
        with self._lock:
            cache_key = f"inspect:{image_url}"
            if cache_key in self._inspect_cache:
                return self._inspect_cache[cache_key]
        result = run([self._path, "inspect", "--no-tags", image_url],
                     f"skopeo inspect failed: {image_url}")
        data = json.loads(result.stdout)
        with self._lock:
            self._inspect_cache[f"inspect:{image_url}"] = data
        return data

    def exists(self, image_url: str) -> bool:
        try:
            subprocess.run([self._path, "inspect", "--no-tags", image_url],
                           check=True, capture_output=True, text=True)
            return True
        except subprocess.CalledProcessError:
            return False


# ---------------------------------------------------------------------------
# Image resolution
# ---------------------------------------------------------------------------

def resolve_image(skopeo: Skopeo, image: str) -> str:
    raw = image.removeprefix(OCI_PROTO).removeprefix(DOCKER_PROTO)
    if not raw.startswith(RHDH_REGISTRY):
        return image

    proto = OCI_PROTO if image.startswith(OCI_PROTO) else (DOCKER_PROTO if image.startswith(DOCKER_PROTO) else "")
    docker_url = f"{DOCKER_PROTO}{raw}"

    if skopeo.exists(docker_url):
        return image

    fallback = raw.replace(RHDH_REGISTRY, RHDH_FALLBACK, 1)
    log(f"\t==> Falling back to {RHDH_FALLBACK} for {raw}")
    return f"{proto}{fallback}"


# ---------------------------------------------------------------------------
# OCI image downloader (shared, thread-safe)
# ---------------------------------------------------------------------------

class OciImageCache:
    """Downloads OCI images once and caches tarballs. Thread-safe."""

    def __init__(self, skopeo: Skopeo, tmp_dir: str):
        self._skopeo = skopeo
        self._tmp_dir = tmp_dir
        self._cache: dict[str, str] = {}  # image_url -> tarball_path
        self._lock = Lock()

    def get_tarball(self, image: str) -> str:
        resolved = resolve_image(self._skopeo, image)

        with self._lock:
            if resolved in self._cache:
                return self._cache[resolved]

        # Download outside the lock (allows parallel downloads)
        digest = hashlib.sha256(resolved.encode(), usedforsecurity=False).hexdigest()
        local_dir = os.path.join(self._tmp_dir, digest)
        docker_url = resolved.replace(OCI_PROTO, DOCKER_PROTO)

        log(f"\t==> Downloading {resolved}")
        self._skopeo.copy(docker_url, f"dir:{local_dir}")

        manifest = json.load(open(os.path.join(local_dir, "manifest.json")))  # NOSONAR - local_dir is a temp dir created by this script
        layer_digest = manifest["layers"][0]["digest"]
        tarball = os.path.join(local_dir, layer_digest.split(":")[1])

        with self._lock:
            self._cache[resolved] = tarball

        return tarball

    def get_digest(self, image: str) -> str:
        resolved = resolve_image(self._skopeo, image)
        docker_url = resolved.replace(OCI_PROTO, DOCKER_PROTO)
        data = self._skopeo.inspect(docker_url)
        return data["Digest"].split(":")[1]

    def get_plugin_paths(self, image: str) -> list[str]:
        resolved = resolve_image(self._skopeo, image)
        docker_url = resolved.replace(OCI_PROTO, DOCKER_PROTO)
        manifest = self._skopeo.inspect_raw(docker_url)
        annotation = manifest.get("annotations", {}).get("io.backstage.dynamic-packages")
        if not annotation:
            return []
        decoded = json.loads(base64.b64decode(annotation).decode("utf-8"))
        paths = []
        for obj in decoded:
            if isinstance(obj, dict):
                paths.extend(obj.keys())
        return paths


# ---------------------------------------------------------------------------
# Tar extraction
# ---------------------------------------------------------------------------

def extract_oci_plugin(tarball: str, plugin_path: str, destination: str) -> None:
    plugin_dir = os.path.join(destination, plugin_path)
    if os.path.exists(plugin_dir):
        shutil.rmtree(plugin_dir, ignore_errors=True)

    with tarfile.open(tarball, "r:*") as tar:  # NOSONAR - tarball is an internal path from OciImageCache
        members = []
        for m in tar.getmembers():
            if not m.name.startswith(plugin_path):
                continue
            if m.size > MAX_ENTRY_SIZE:
                raise InstallException(f"Zip bomb detected: {m.name}")
            if (m.islnk() or m.issym()):
                real = os.path.realpath(os.path.join(plugin_path, *os.path.split(m.linkname)))
                if not real.startswith(plugin_path):
                    continue
            members.append(m)
        tar.extractall(os.path.abspath(destination), members=members, filter="tar")


def extract_npm_package(archive: str, destination: str) -> str:
    prefix = "package/"
    pkg_dir = archive.replace(".tgz", "")
    pkg_dir_real = os.path.realpath(pkg_dir)

    if os.path.exists(pkg_dir):
        shutil.rmtree(pkg_dir, ignore_errors=True)
    os.mkdir(pkg_dir)

    with tarfile.open(archive, "r:*") as tar:  # NOSONAR - archive is an internal path from npm pack output
        members = []
        for m in tar.getmembers():
            if m.isdir():
                continue
            if m.isreg():
                if not m.name.startswith(prefix):
                    raise InstallException(f"NPM archive entry doesn't start with 'package/': {m.name}")
                if m.size > MAX_ENTRY_SIZE:
                    raise InstallException(f"Zip bomb detected: {m.name}")
                m.name = m.name.removeprefix(prefix)
                members.append(m)
            elif m.islnk() or m.issym():
                if not m.linkpath.startswith(prefix):
                    raise InstallException(f"NPM archive link outside archive: {m.name} -> {m.linkpath}")
                m.name = m.name.removeprefix(prefix)
                m.linkpath = m.linkpath.removeprefix(prefix)
                real = os.path.realpath(os.path.join(pkg_dir, *os.path.split(m.linkname)))
                if not real.startswith(pkg_dir_real):
                    raise InstallException(f"NPM archive link escape: {m.name} -> {m.linkpath}")
                members.append(m)
            else:
                raise InstallException(f"NPM archive non-regular file: {m.name}")
        tar.extractall(pkg_dir, members=members, filter="data")

    os.remove(archive)
    return os.path.basename(pkg_dir_real)


# ---------------------------------------------------------------------------
# Integrity verification (pure Python, no subprocess)
# ---------------------------------------------------------------------------

def verify_integrity(package: str, archive: str, integrity_str: str) -> None:
    parts = integrity_str.split("-", 1)
    if len(parts) != 2:
        raise InstallException(f"{package}: integrity must be <algorithm>-<hash>")

    algo, expected_b64 = parts
    if algo not in RECOGNIZED_ALGORITHMS:
        raise InstallException(f"{package}: unsupported algorithm {algo}")

    try:
        base64.b64decode(expected_b64, validate=True)
    except binascii.Error:
        raise InstallException(f"{package}: invalid base64 hash")

    h = hashlib.new(algo)
    with open(archive, "rb") as f:  # NOSONAR - archive is an internal path from npm pack output
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    actual_b64 = base64.b64encode(h.digest()).decode("utf-8")

    if actual_b64 != expected_b64:
        raise InstallException(f"{package}: integrity mismatch (got {actual_b64}, expected {expected_b64})")


# ---------------------------------------------------------------------------
# Package key parsing (NPM)
# ---------------------------------------------------------------------------

_NPM_PKG_RE = re.compile(r"^(@[^/]+/)?([^@]+)(?:@(.+))?$")
_NPM_ALIAS_RE = re.compile(r"^([^@]+)@npm:(@[^/]+/)?([^@]+)(?:@(.+))?$")
_GIT_URL_PREFIXES = ("git+https://", "git+ssh://", "git://", "https://github.com/", "git@github.com:", "github:")


def npm_plugin_key(package: str) -> str:
    if package.startswith("./") or package.endswith(".tgz"):
        return package

    alias = _NPM_ALIAS_RE.match(package)
    if alias:
        scope = alias.group(2) or ""
        name = alias.group(3)
        return f"{alias.group(1)}@npm:{scope}{name}"

    for pfx in _GIT_URL_PREFIXES:
        if package.startswith(pfx):
            return package.split("#")[0]
    # Also handle user/repo format
    if "/" in package and not package.startswith("@") and "://" not in package:
        return package.split("#")[0]

    m = _NPM_PKG_RE.match(package)
    if m:
        return f"{m.group(1) or ''}{m.group(2)}"
    return package


# ---------------------------------------------------------------------------
# Package key parsing (OCI)
# ---------------------------------------------------------------------------

_OCI_RE = re.compile(
    r"^(" + re.escape(OCI_PROTO) + r"[^\s/:@]+(?::\d+)?(?:/[^\s:@]+)+)"
    r"(?::([^\s!@:]+)|@((?:sha256|sha512|blake3):[^\s!@:]+))"
    r"(?:!([^\s]+))?$"
)


def oci_plugin_key(package: str, image_cache: OciImageCache | None = None) -> tuple[str, str, bool, str | None]:
    m = _OCI_RE.match(package)
    if not m:
        raise InstallException(f"Invalid OCI package format: {package}")

    registry = m.group(1)
    tag = m.group(2)
    digest = m.group(3)
    path = m.group(4)
    version = tag or digest
    inherit = tag == "{{inherit}}" and digest is None

    if inherit and not path:
        return registry, version, True, None

    if not path and image_cache:
        full = f"{registry}:{version}" if tag else f"{registry}@{version}"
        paths = image_cache.get_plugin_paths(full)
        if len(paths) == 0:
            raise InstallException(f"No plugins found in OCI image {full}")
        if len(paths) > 1:
            raise InstallException(f"Multiple plugins in {full}: {paths}. Use !<path> to specify.")
        path = paths[0]
        log(f"\t==> Auto-detected plugin path: {path}")

    return f"{registry}:!{path}", version, inherit, path


# ---------------------------------------------------------------------------
# Plugin merging
# ---------------------------------------------------------------------------

def merge_plugins_from_config(
    config_file: str,
    all_plugins: dict[str, dict],
    level: int,
    image_cache: OciImageCache | None = None,
) -> None:
    with open(config_file) as f:
        content = yaml.safe_load(f)

    if not isinstance(content, dict) or "plugins" not in content:
        raise InstallException(f"{config_file} must contain a 'plugins' list")

    for plugin in content["plugins"]:
        pkg = plugin["package"]
        if pkg.startswith(OCI_PROTO):
            _merge_oci_plugin(plugin, all_plugins, config_file, level, image_cache)
        else:
            _merge_npm_plugin(plugin, all_plugins, config_file, level)


def _merge_npm_plugin(plugin: dict, all_plugins: dict, src: str, level: int) -> None:
    key = npm_plugin_key(plugin["package"])
    _do_merge(key, plugin, all_plugins, src, level)


def _merge_oci_plugin(
    plugin: dict,
    all_plugins: dict,
    src: str,
    level: int,
    image_cache: OciImageCache | None,
) -> None:
    key, version, inherit, resolved_path = oci_plugin_key(plugin["package"], image_cache)

    if inherit and resolved_path is None:
        matches = [k for k in all_plugins if k.startswith(f"{key}:!")]
        if len(matches) == 0:
            raise InstallException(f"Cannot {{inherit}} for {key}: no base config found")
        if len(matches) > 1:
            raise InstallException(f"Cannot {{inherit}} for {key}: multiple matches: {matches}")
        key = matches[0]
        base = all_plugins[key]
        version = base["version"]
        resolved_path = key.split(":!")[-1]
        registry_part = key.split(":!")[0]
        plugin["package"] = f"{registry_part}:{version}!{resolved_path}"

    elif "!" not in plugin["package"]:
        plugin["package"] = f"{plugin['package']}!{resolved_path}"

    plugin["version"] = version
    _do_merge(key, plugin, all_plugins, src, level)


def _do_merge(key: str, plugin: dict, all_plugins: dict, src: str, level: int) -> None:
    if key not in all_plugins:
        plugin["_level"] = level
        all_plugins[key] = plugin
    else:
        if all_plugins[key].get("_level") == level:
            raise InstallException(f"Duplicate plugin config for {plugin['package']} in {src}")
        all_plugins[key]["_level"] = level
        for k, v in plugin.items():
            if k == "package" and plugin["package"].startswith(OCI_PROTO):
                all_plugins[key][k] = v
            elif k != "version":
                all_plugins[key][k] = v
        if "version" in plugin:
            all_plugins[key]["version"] = plugin["version"]


# ---------------------------------------------------------------------------
# Plugin installation
# ---------------------------------------------------------------------------

def compute_plugin_hash(plugin: dict) -> str:
    d = copy.deepcopy(plugin)
    d.pop("pluginConfig", None)
    d.pop("version", None)
    d.pop("_level", None)

    pkg = plugin["package"]
    if pkg.startswith("./"):
        d["_local"] = _local_pkg_info(pkg)

    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()


def _local_pkg_info(pkg_path: str) -> dict:
    abs_path = os.path.join(os.getcwd(), pkg_path.removeprefix("./")) if pkg_path.startswith("./") else pkg_path
    pj = os.path.join(abs_path, "package.json")
    if not os.path.isfile(pj):
        return {"_mtime": os.path.getmtime(abs_path)} if os.path.isdir(abs_path) else {"_missing": True}
    try:
        with open(pj) as f:
            info: dict[str, Any] = {"_pj": json.load(f), "_pj_mtime": os.path.getmtime(pj)}
        for lf in ("package-lock.json", "yarn.lock"):
            lp = os.path.join(abs_path, lf)
            if os.path.isfile(lp):
                info[f"_{lf}_mtime"] = os.path.getmtime(lp)
        return info
    except Exception as e:
        return {"_err": str(e)}


def install_oci_plugin(
    plugin: dict,
    destination: str,
    image_cache: OciImageCache,
    installed: dict[str, str],
) -> tuple[str | None, dict]:
    pkg = plugin["package"]
    if plugin.get("disabled", False):
        return None, {}

    plugin_hash = plugin["plugin_hash"]

    # Skip check
    pull_policy = plugin.get("pullPolicy", PullPolicy.ALWAYS if ":latest!" in pkg else PullPolicy.IF_NOT_PRESENT)
    if plugin_hash in installed:
        if pull_policy == PullPolicy.IF_NOT_PRESENT:
            log(f"\t==> Already installed, skipping")
            installed.pop(plugin_hash)
            return None, plugin.get("pluginConfig", {})
        if pull_policy == PullPolicy.ALWAYS:
            path_installed = installed[plugin_hash]
            digest_file = os.path.join(destination, path_installed, "dynamic-plugin-image.hash")
            if os.path.isfile(digest_file):
                local_digest = open(digest_file).read().strip()
                image_part = pkg.split("!")[0]
                remote_digest = image_cache.get_digest(image_part)
                if local_digest == remote_digest:
                    log(f"\t==> Digest unchanged, skipping")
                    installed.pop(plugin_hash)
                    return None, plugin.get("pluginConfig", {})

    # Download and extract
    if plugin.get("version") is None:
        raise InstallException(f"No version for {pkg}")

    image_part, plugin_path = pkg.split("!")
    tarball = image_cache.get_tarball(image_part)
    extract_oci_plugin(tarball, plugin_path, destination)

    # Save digest
    plugin_dir = os.path.join(destination, plugin_path)
    os.makedirs(plugin_dir, exist_ok=True)
    with open(os.path.join(plugin_dir, "dynamic-plugin-image.hash"), "w") as f:
        f.write(image_cache.get_digest(image_part))

    # Save config hash
    with open(os.path.join(plugin_dir, "dynamic-plugin-config.hash"), "w") as f:
        f.write(plugin_hash)

    # Clean old hash tracking
    for k in [k for k, v in installed.items() if v == plugin_path]:
        installed.pop(k)

    return plugin_path, plugin.get("pluginConfig", {})


def install_npm_plugin(
    plugin: dict,
    destination: str,
    skip_integrity: bool,
    installed: dict[str, str],
) -> tuple[str | None, dict]:
    pkg = plugin["package"]
    if plugin.get("disabled", False):
        return None, {}

    plugin_hash = plugin["plugin_hash"]
    force = plugin.get("forceDownload", False)

    if plugin_hash in installed and not force:
        pull_policy = plugin.get("pullPolicy", PullPolicy.IF_NOT_PRESENT)
        if pull_policy != PullPolicy.ALWAYS:
            log(f"\t==> Already installed, skipping")
            installed.pop(plugin_hash)
            return None, plugin.get("pluginConfig", {})

    is_local = pkg.startswith("./")
    actual_pkg = os.path.join(os.getcwd(), pkg[2:]) if is_local else pkg

    if not is_local and not skip_integrity and "integrity" not in plugin:
        raise InstallException(f"No integrity hash for {pkg}")

    log(f"\t==> Running npm pack")
    result = run(["npm", "pack", actual_pkg], f"npm pack failed for {pkg}", cwd=destination)
    archive = os.path.join(destination, result.stdout.strip())

    if not is_local and not skip_integrity:
        log(f"\t==> Verifying integrity")
        verify_integrity(pkg, archive, plugin["integrity"])

    plugin_path = extract_npm_package(archive, destination)

    with open(os.path.join(destination, plugin_path, "dynamic-plugin-config.hash"), "w") as f:
        f.write(plugin_hash)

    for k in [k for k, v in installed.items() if v == plugin_path]:
        installed.pop(k)

    return plugin_path, plugin.get("pluginConfig", {})


# ---------------------------------------------------------------------------
# Catalog index extraction
# ---------------------------------------------------------------------------

def extract_catalog_index(skopeo: Skopeo, image: str, mount_dir: str, entities_dir: str) -> str:
    log(f"\n======= Extracting catalog index from {image}")
    resolved = resolve_image(skopeo, image)

    temp_dir = os.path.join(mount_dir, ".catalog-index-temp")
    os.makedirs(temp_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        url = resolved if resolved.startswith(DOCKER_PROTO) else f"{DOCKER_PROTO}{resolved}"
        local = os.path.join(tmp, "idx")
        log("\t==> Downloading catalog index image")
        skopeo.copy(url, f"dir:{local}")

        manifest = json.load(open(os.path.join(local, "manifest.json")))
        for layer in manifest.get("layers", []):
            digest = layer.get("digest", "")
            if not digest:
                continue
            fname = digest.split(":")[1]
            fpath = os.path.join(local, fname)
            if os.path.isfile(fpath):
                with tarfile.open(fpath, "r:*") as tar:
                    safe = [m for m in tar.getmembers() if m.size <= MAX_ENTRY_SIZE]
                    tar.extractall(temp_dir, members=safe, filter="data")

    dpdy = os.path.join(temp_dir, "dynamic-plugins.default.yaml")
    if not os.path.isfile(dpdy):
        raise InstallException(f"dynamic-plugins.default.yaml not found in {image}")
    log("\t==> Extracted dynamic-plugins.default.yaml")

    # Extract catalog entities
    for subdir in ("catalog-entities/extensions", "catalog-entities/marketplace"):
        src = os.path.join(temp_dir, subdir)
        if os.path.isdir(src):
            os.makedirs(entities_dir, exist_ok=True)
            dst = os.path.join(entities_dir, "catalog-entities")
            if os.path.exists(dst):
                shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst, dirs_exist_ok=True)
            log(f"\t==> Extracted catalog entities from {subdir}")
            break

    return dpdy


# ---------------------------------------------------------------------------
# Lock file
# ---------------------------------------------------------------------------

def create_lock(path: str) -> None:
    while True:
        try:
            with open(path, "x"):
                log(f"======= Created lock: {path}")
                return
        except FileExistsError:
            log(f"======= Waiting for lock: {path}")
            while os.path.exists(path):
                time.sleep(1)


def remove_lock(path: str) -> None:
    try:
        os.remove(path)
        log(f"======= Removed lock: {path}")
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <dynamic-plugins-root>")
        sys.exit(1)

    root = sys.argv[1]
    lock_path = os.path.join(root, "install-dynamic-plugins.lock")
    atexit.register(remove_lock, lock_path)
    atexit.register(lambda: cleanup_temp(root))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    create_lock(lock_path)

    skopeo = Skopeo()
    workers = get_workers()
    log(f"======= Workers: {workers} (CPUs: {os.cpu_count()})")

    # Catalog index
    catalog_image = os.environ.get("CATALOG_INDEX_IMAGE", "")
    catalog_dpdy: str | None = None
    if catalog_image:
        entities_dir = os.environ.get("CATALOG_ENTITIES_EXTRACT_DIR", os.path.join(tempfile.gettempdir(), "extensions"))
        catalog_dpdy = extract_catalog_index(skopeo, catalog_image, root, entities_dir)

    skip_integrity = os.environ.get("SKIP_INTEGRITY_CHECK", "").lower() == "true"
    config_file = "dynamic-plugins.yaml"
    global_config_file = os.path.join(root, "app-config.dynamic-plugins.yaml")

    if not os.path.isfile(config_file):
        log(f"No {config_file} found. Skipping.")
        open(global_config_file, "w").write("")
        return

    with open(config_file) as f:
        content = yaml.safe_load(f)

    if not content:
        log(f"{config_file} is empty. Skipping.")
        open(global_config_file, "w").write("")
        return

    # Create shared image cache
    tmp_obj = tempfile.TemporaryDirectory()
    image_cache = OciImageCache(skopeo, tmp_obj.name)

    # Process includes
    all_plugins: dict[str, dict] = {}
    includes = content.get("includes", [])

    if catalog_dpdy and "dynamic-plugins.default.yaml" in includes:
        idx = includes.index("dynamic-plugins.default.yaml")
        includes[idx] = catalog_dpdy

    for inc in includes:
        if not os.path.isfile(inc):
            log(f"WARNING: {inc} not found, skipping")
            continue
        log(f"\n======= Including plugins from {inc}")
        merge_plugins_from_config(inc, all_plugins, level=0, image_cache=image_cache)

    # Process main plugins
    if "plugins" in content:
        for plugin in content["plugins"]:
            pkg = plugin["package"]
            if pkg.startswith(OCI_PROTO):
                _merge_oci_plugin(plugin, all_plugins, config_file, level=1, image_cache=image_cache)
            else:
                _merge_npm_plugin(plugin, all_plugins, config_file, level=1)

    # Compute hashes
    for p in all_plugins.values():
        p["plugin_hash"] = compute_plugin_hash(p)

    # Read currently installed
    installed: dict[str, str] = {}
    for d in os.listdir(root):
        hf = os.path.join(root, d, "dynamic-plugin-config.hash")
        if os.path.isfile(hf):
            installed[open(hf).read().strip()] = d

    global_config: dict = {"dynamicPlugins": {"rootDirectory": "dynamic-plugins-root"}}

    # Separate plugins by type for different installation strategies
    oci_plugins: dict[str, dict] = {}
    npm_plugins: dict[str, dict] = {}
    disabled: dict[str, dict] = {}
    skipped_local: dict[str, dict] = {}

    for k, v in all_plugins.items():
        pkg = v["package"]
        if v.get("disabled", False):
            disabled[k] = v
        elif pkg.startswith(OCI_PROTO):
            oci_plugins[k] = v
        elif pkg.startswith("./"):
            # Local plugins: check if the directory actually exists
            local_path = os.path.join(os.getcwd(), pkg[2:])
            if os.path.isdir(local_path):
                npm_plugins[k] = v
            else:
                skipped_local[k] = v
        else:
            npm_plugins[k] = v

    for k, v in disabled.items():
        log(f"\n======= Skipping disabled plugin {v['package']}")

    if skipped_local:
        log(f"\n======= Skipping {len(skipped_local)} local plugins (directories not found)")
        for k, v in skipped_local.items():
            log(f"\t==> {v['package']} (not found at {os.path.join(os.getcwd(), v['package'][2:])})")
            # Still merge pluginConfig so frontend config is available
            pc = v.get("pluginConfig")
            if pc and isinstance(pc, dict):
                global_config = deep_merge(pc, global_config)

    install_lock = Lock()
    errors: list[str] = []

    def install_one_oci(key: str, plugin: dict) -> tuple[str | None, dict]:
        log(f"\n======= Installing OCI plugin {plugin['package']}")
        return install_oci_plugin(plugin, root, image_cache, installed)

    # Phase 1: Parallel OCI downloads + extraction
    if oci_plugins:
        log(f"\n======= Installing {len(oci_plugins)} OCI plugins ({workers} workers)")

        if workers > 1:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(install_one_oci, k, v): (k, v) for k, v in oci_plugins.items()}
                for future in as_completed(futures):
                    key, plugin = futures[future]
                    try:
                        path, config = future.result()
                        if config:
                            with install_lock:
                                global_config = deep_merge(config, global_config) if isinstance(config, dict) else global_config
                        if path:
                            log(f"\t==> Installed {plugin['package']}")
                    except Exception as e:
                        errors.append(f"{plugin['package']}: {e}")
                        log(f"\t==> ERROR: {plugin['package']}: {e}")
        else:
            for key, plugin in oci_plugins.items():
                try:
                    path, config = install_one_oci(key, plugin)
                    if config and isinstance(config, dict):
                        global_config = deep_merge(config, global_config)
                    if path:
                        log(f"\t==> Installed {plugin['package']}")
                except Exception as e:
                    errors.append(f"{plugin['package']}: {e}")
                    log(f"\t==> ERROR: {plugin['package']}: {e}")

    # Phase 2: Sequential NPM installs (npm pack is not thread-safe)
    if npm_plugins:
        log(f"\n======= Installing {len(npm_plugins)} NPM plugins (sequential)")
        for key, plugin in npm_plugins.items():
            log(f"\n======= Installing NPM plugin {plugin['package']}")
            try:
                path, config = install_npm_plugin(plugin, root, skip_integrity, installed)
                if config and isinstance(config, dict):
                    global_config = deep_merge(config, global_config)
                if path:
                    log(f"\t==> Installed {plugin['package']}")
            except Exception as e:
                errors.append(f"{plugin['package']}: {e}")
                log(f"\t==> ERROR: {plugin['package']}: {e}")

    # Write global config
    with open(global_config_file, "w") as f:
        yaml.safe_dump(global_config, f)

    # Clean removed plugins
    for h, d in installed.items():
        plugin_dir = os.path.join(root, d)
        log(f"\n======= Removing old plugin {d}")
        shutil.rmtree(plugin_dir, ignore_errors=True)

    # Clean temp
    tmp_obj.cleanup()

    if errors:
        log(f"\n======= {len(errors)} plugin(s) failed:")
        for e in errors:
            log(f"  - {e}")
        sys.exit(1)

    log("\n======= All plugins installed successfully")


def cleanup_temp(root: str) -> None:
    d = os.path.join(root, ".catalog-index-temp")
    if os.path.exists(d):
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    main()
