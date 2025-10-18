// BEGIN-NOSCAN
export const plugins = [
  {
    name: 'backstage-plugin-argo-cd-backend-wrapped-dynamic',
    version: '2.11.3-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'argocd',
      },
    },
  },
  {
    name: 'backstage-plugin-gitlab-backend-wrapped-dynamic',
    version: '6.2.0-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'gitlab',
      },
    },
  },
  {
    name: 'backstage-plugin-keycloak-backend-wrapped-dynamic',
    version: '1.5.5-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
    },
  },
  {
    name: 'backstage-plugin-ocm-backend-wrapped-dynamic',
    version: '3.2.2-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'ocm',
      },
    },
  },
  {
    name: 'plugin-azure-devops-backend-wrapped-dynamic',
    version: '0.4.2-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'azure-devops',
      },
    },
  },
  {
    name: 'plugin-catalog-backend-module-github-wrapped-dynamic',
    version: '0.4.3-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
    },
  },
  {
    name: 'plugin-catalog-backend-module-gitlab-wrapped-dynamic',
    version: '0.3.2-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
    },
  },
  {
    name: 'plugin-jenkins-backend-wrapped-dynamic',
    version: '0.2.8-dynamic.0',
    platform: 'node',
    role: 'backend-plugin',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'jenkins',
      },
    },
  },
  {
    name: 'plugin-kubernetes-backend-wrapped-dynamic',
    version: '0.12.2-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'kubernetes',
      },
    },
  },
  {
    name: 'plugin-scaffolder-backend-module-gitlab-wrapped-dynamic',
    version: '0.2.8-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
    },
  },
  {
    name: 'plugin-sonarqube-backend-wrapped-dynamic',
    version: '0.2.7-dynamic.0',
    platform: 'node',
    role: 'backend-plugin',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'sonarqube',
      },
    },
  },
  {
    name: 'plugin-techdocs-backend-wrapped-dynamic',
    version: '1.7.2-dynamic.0',
    platform: 'node',
    role: 'backend-plugin',
    installer: {
      kind: 'legacy',
      router: {
        pluginID: 'techdocs',
      },
    },
  },
  {
    name: 'scaffolder-backend-argocd-wrapped-dynamic',
    version: '1.1.17-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
    },
  },
  {
    name: 'scaffolder-backend-module-utils-wrapped-dynamic',
    version: '1.10.4-dynamic.0',
    platform: 'node',
    role: 'backend-plugin-module',
    installer: {
      kind: 'legacy',
    },
  },
];
// END-NOSCAN
