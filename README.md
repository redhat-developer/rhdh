# Red Hat Developer Hub (RHDH)

[0]: https://quay.io/repository/rhdh-community/rhdh
[0]: https://quay.io/repository/rhdh/rhdh-hub-rhel9

[![Quay.io registry](https://img.shields.io/badge/Quay.io-rhdh--community/rhdh:next-white?logoColor=white&labelColor=grey&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSIzOS43IiB2aWV3Qm94PSIwIDAgMzkuNyAzOS43Ij48ZyB0cmFuc2Zvcm09Im1hdHJpeCguMzk0NTggMCAwIC4zOTQ1OCAxLjA4MiAuMTA1KSI+PGNpcmNsZSBjeD0iNTUuMDY5IiBjeT0iNTAiIHI9IjUwIiBmaWxsPSIjRDcxRTAwIi8+PHBhdGggZmlsbD0iI0MyMUEwMCIgZD0iTTkwLjQyOSAxNC42NDFjMTkuNTI5IDE5LjUyOSAxOS41MjkgNTEuMTkgMCA3MC43MTgtMTkuNTI5IDE5LjUzLTUxLjE5MiAxOS41My03MC43MiAwbDcwLjcyLTcwLjcxOHoiLz48cGF0aCBmaWxsPSIjRkZGIiBkPSJtNTkuNjA4IDQ5Ljk5IDE1LjA2IDMxLjg2OWgtMTIuODNMNDYuNzg5IDQ5Ljk5bDE1LjA0OS0zMS44NWgxMi44M3oiLz48cGF0aCBmaWxsPSIjQjdCN0I3IiBkPSJtNzQuNjY4IDgxLjg1OSAxNS4wNS0zMS44NjktMTUuMDUtMzEuODUtNi40MSAxMy41NiA4LjY0IDE4LjI5LTguNjQgMTguMzAxeiIvPjxwYXRoIGZpbGw9IiNGRkYiIGQ9Im0zMy4yMzkgNDkuOTkgMTUuMDYgMzEuODY5aC0xMi44M0wyMC40MTkgNDkuOTlsMTUuMDUtMzEuODVoMTIuODN6Ii8+PHBhdGggZmlsbD0iI0I3QjdCNyIgZD0ibTQ4LjY1OSA0Ni4wNCA2LjQxLTEzLjU3LTYuNzctMTQuMzMtNi40MiAxMy41N3pNNDEuODc5IDY4LjI5MWw2LjQyIDEzLjU2OCA2Ljc3LTE0LjMzLTYuNDEtMTMuNTY4eiIvPjwvZz48L3N2Zz4K)][0]

## Purpose

Red Hat Developer Hub is an enterprise-grade Internal Developer Portal based on Backstage.

RHDH includes the ArgoCD, GitHub Issues, Keycloak, Kubernetes, OCM, Tekton, and Topology plugin. Each of these plugins have been hand picked or created by Red Hat and the Backstage Community.

## Features

Today, we have several plugins integrated into RHDH as a way to demonstrate the versatility of Backstage. Some of these integrations are plugins that we have built while others are ones that we see as must haves in most Backstage instances.

Our current list of plugins include:

- [ArgoCD plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/redhat-argocd/plugins/argocd)
- [OCM plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/ocm/plugins/ocm)
- [Quay plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/quay/plugins/quay)
- [Kubernetes plugin](https://github.com/backstage/backstage/tree/master/plugins/kubernetes)
- [Topology plugin](https://github.com/backstage/community-plugins/blob/main/workspaces/topology/plugins/topology/README.md)
- [GitHub Insights plugin](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/frontend/backstage-plugin-github-insights)
- [GitHub Pull Requests plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/github-pull-requests-board/plugins/github-pull-requests-board)
- [GitHub Actions plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/github-actions/plugins/github-actions)
- [GitHub Issues plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/github-issues/plugins/github-issues)
- [GitHub Discovery](https://backstage.io/docs/integrations/github/discovery) & [Org Data](https://backstage.io/docs/integrations/github/org)
- [Security Insights plugin](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/frontend/backstage-plugin-security-insights)
- [Keycloak plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/keycloak/plugins/catalog-backend-module-keycloak)
- [SonarQube plugin](https://roadie.io/backstage/plugins/sonarqube/)
- [Tekton plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/tekton/plugins/tekton)
- [Azure DevOps plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/azure-devops/plugins/azure-devops)
- [Jenkins plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/jenkins/plugins/jenkins)
- [Notifications plugin](https://github.com/backstage/backstage/tree/master/plugins/notifications)
- [Signals plugin](https://github.com/backstage/backstage/tree/master/plugins/signals)
- [GitLab plugin](https://github.com/immobiliare/backstage-plugin-gitlab)
- [Jira plugin](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/frontend/backstage-plugin-jira)
- [Jfrog Artifactory plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/jfrog-artifactory/plugins/jfrog-artifactory)
- [Datadog plugin](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/frontend/backstage-plugin-datadog)
- [PagerDuty](https://github.com/PagerDuty/backstage-plugin)
- [Lighthouse plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/lighthouse/plugins/lighthouse)
- [Dynatrace plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/dynatrace/plugins/dynatrace)
- [Gitlab Scaffolder actions](https://github.com/backstage/backstage/tree/master/plugins/scaffolder-backend-module-gitlab)
- [Utils Scaffolder actions](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/scaffolder-actions/scaffolder-backend-module-utils)
- [Nexus Repository Manager plugin](https://github.com/backstage/community-plugins/tree/main/workspaces/nexus-repository-manager/plugins/nexus-repository-manager)

## Getting Started

Dependencies:

- [Node.js](https://nodejs.org/en/) - [required version](.nvmrc)
- [corepack](https://github.com/nodejs/corepack)

Information on running RHDH can be found in our [Getting Started](https://github.com/redhat-developer/rhdh/blob/main/docs/index.md) documentation. In the documentation is how to set up and run an instance locally. We plan to expand upon the documentation at a later point if there is enough interest in other methods for getting the app up and running.

We are excited to see people wanting to contribute to our project and welcome anyone who wishes to participate. You are more than welcome to browse through our open issues and tackle anything you feel confident in working on.

We also welcome non code contributions in the form of bug reporting and documentation writing. If you run across any bugs, please raise an issue here in [JIRA](https://issues.redhat.com/browse/RHDHBUGS).

## Community, Discussion, and Support

[Bugs](https://issues.redhat.com/projects/RHDHBUGS) should be filled out here on RHDHBUGS Jira.

## Resources

For more information on our plugin offerings, consult the [RHDH Plugins](https://developers.redhat.com/rhdh/plugins) product page.

Our [Red Hat Developer Blog](https://developers.redhat.com/blog) is a great way to see what we are up to.

Want to know more about Backstage, consult the [documentation](https://backstage.io/docs/overview/what-is-backstage) and [GitHub](https://github.com/backstage/backstage) repo.

## Multi-arch support

RHDH is currently only available for amd64/x86_64.

For additional architecture support, please vote for https://issues.redhat.com/browse/RHIDP-1351 with your reason for needing additional arches.

If you want an image that runs on Mac M1 (arm64/aarch64) or another architecture, you will need to build it yourself.

### Building locally

Check out this repo, choose the branch or tag you want to use, then build an image:

```
podman build -f docker/Dockerfile . -t rhdh:local
```
