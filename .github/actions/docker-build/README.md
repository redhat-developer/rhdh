# Docker Build Action

This GitHub Action builds and optionally pushes Docker images. It supports both standard builds and hermetic builds using the hermeto tool for dependency caching.

## Features

- Standard Docker builds with Docker Buildx
- Hermetic builds using hermeto for offline dependency management
- Automatic Containerfile transformation for hermetic builds
- Support for multiple architectures
- Cleanup of build artifacts

## Inputs

| Name | Description | Required | Default |
|------|-------------|----------|---------|
| `registry` | The registry to push to | Yes | - |
| `password` | The password for the registry | Yes | - |
| `username` | The username for the registry | Yes | - |
| `imageName` | The name of the image to build | Yes | - |
| `imageTags` | The tags to apply to the image | Yes | - |
| `imageLabels` | The labels for the Docker image | No | - |
| `push` | Whether to push the image | Yes | - |
| `platform` | Target CPU platform architecture | No | `linux/amd64` |
| `enableHermeticBuild` | Whether to enable hermetic builds using hermeto | No | `false` |
| `componentDirectory` | Path to the component directory for hermetic builds | No | `distgit/containers/rhdh-hub` |
| `containerfile` | Path to the Containerfile/Dockerfile to use | No | `docker/Dockerfile` |

## Outputs

| Name | Description |
|------|-------------|
| `digest` | The digest of the built Docker image |

## Usage Examples

### Standard Build

```yaml
- name: Build and push Docker image
  uses: ./.github/actions/docker-build
  with:
    registry: quay.io
    username: ${{ secrets.REGISTRY_USERNAME }}
    password: ${{ secrets.REGISTRY_PASSWORD }}
    imageName: myorg/myapp
    imageTags: |
      type=ref,event=branch
      type=ref,event=pr
      type=sha
    push: true
```

### Hermetic Build

```yaml
- name: Build and push Docker image (Hermetic)
  uses: ./.github/actions/docker-build
  with:
    registry: quay.io
    username: ${{ secrets.REGISTRY_USERNAME }}
    password: ${{ secrets.REGISTRY_PASSWORD }}
    imageName: myorg/myapp
    imageTags: |
      type=ref,event=branch
      type=ref,event=pr
      type=sha
    push: true
    enableHermeticBuild: true
    componentDirectory: distgit/containers/rhdh-hub
    containerfile: distgit/containers/rhdh-hub/Containerfile
```

### Complete Workflow Example

```yaml
name: Build Container Image

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: quay.io/myorg/myapp
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=sha

      - name: Build and push Docker image
        uses: ./.github/actions/docker-build
        with:
          registry: quay.io
          username: ${{ secrets.QUAY_USERNAME }}
          password: ${{ secrets.QUAY_PASSWORD }}
          imageName: myorg/myapp
          imageTags: ${{ steps.meta.outputs.tags }}
          imageLabels: ${{ steps.meta.outputs.labels }}
          push: ${{ github.event_name != 'pull_request' }}
          enableHermeticBuild: true
```

## Hermetic Builds

When `enableHermeticBuild` is set to `true`, the action performs the following additional steps:

1. **Dependency Caching**: Uses the hermeto tool to cache all dependencies (RPM, Yarn, and Python packages) locally
2. **Containerfile Transformation**: Creates a local copy of the Containerfile/Dockerfile and modifies it to:
   - Configure DNF/MicroDNF to use cached repositories
   - Inject cachi2 environment variables into RUN commands
3. **Offline Build**: Builds the container with network access disabled, using only cached dependencies
4. **Cleanup**: Removes the transformed Containerfile after the build

### Prerequisites for Hermetic Builds

- The repository should contain the component directory structure expected by hermeto
- Required files in the component directory:
  - `Containerfile` or `Dockerfile`
  - `yarn.lock` (for Yarn dependencies)
  - `python/requirements.txt` (for Python dependencies)
  - RPM specifications as needed

### Troubleshooting Hermetic Builds

If you encounter dependency caching issues:

1. Check that all required lock files are present and up-to-date
2. Verify that the `componentDirectory` path is correct
3. Remove any local `yarn.lock` files in dynamic plugin wrapper directories
4. Check the hermeto cache logs for missing packages

## Performance Considerations

- Hermetic builds are slower due to the dependency caching phase
- Standard builds are recommended for development and testing
- Hermetic builds are ideal for production releases and compliance requirements
- The hermeto cache can be reused across builds if properly configured 