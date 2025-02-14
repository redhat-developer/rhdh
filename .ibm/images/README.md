# RHDH E2E Runner Image

This directory (`.ibm/images/`) contains the **Dockerfile** for building the `rhdh-e2e-runner` image.
This image is used as the **default execution environment** for end-to-end (E2E) tests in OpenShift CI.

## 🚀 **How the Image is Used in OpenShift CI**
- By default, tests use the mirrored image from OpenShift CI: registry.ci.openshift.org/ci/rhdh-e2e-runner:latest

- If no changes are detected in `.ibm/images/`, **the default image is used without any rebuild**.
- If modifications **are made to `.ibm/images/`**, a **temporary image** is built and used **only during the PR tests**.

---

## **How the Image Build Process Works**

The GitHub Actions workflow is designed to **conditionally** build and push the image based on changes to `.ibm/images/`.

### 🔹 **Pull Request Workflow (`PR` Branch)**
1. **If there are changes in `.ibm/images/`**:
- A **temporary image is built** and pushed to OpenShift Registry.
- The `latest` tag in OpenShift is temporarily updated to use this new image.
- Tests in OpenShift CI run using this temporary image.
- **After the tests finish (even if they fail), a rollback is performed** to restore the original image.

2. **If there are NO changes in `.ibm/images/`**:
- The default OpenShift mirror image (`registry.ci.openshift.org/ci/rhdh-e2e-runner:latest`) is used.
- No new image is built, and no rollback is required.

---

### 🔹 **Push to `main` Workflow**
1. **If there are changes in `.ibm/images/` on `main`**:
- A new **permanent** image is built and pushed to OpenShift Registry.
- This new image replaces the previous `latest` version permanently.

2. **If there are no changes in `.ibm/images/`**:
- No new image is built, and the workflow exits early.

---

## 🔄 **Step-by-Step Image Handling Process**

| Step | What Happens? |
|------|--------------|
| **1. PR Created with Changes in `.ibm/images/`** | A **temporary image** is built and tagged as `temp-<PR_ID>` in OpenShift Registry. |
| **2. Update OpenShift Registry** | The `latest` tag is temporarily updated to use this new image. |
| **3. OpenShift CI Runs Tests** | The tests run using the newly built image. |
| **4. Tests Finish (Success or Failure)** | The **rollback** process is triggered. |
| **5. Rollback** | The **original image is restored** in OpenShift Registry. |
| **6. PR is Merged to `main`** | If `.ibm/images/` was modified, the new image is permanently pushed as `latest`. |

---

## 🛠️ **Manually Building and Testing the Image Locally**
If you need to build and test the image locally before pushing:

1. **Build the image:**
 ```sh
 podman build -t rhdh-e2e-runner:local .ibm/images/
 ```


