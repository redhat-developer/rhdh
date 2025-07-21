import { z } from 'zod';

/**
 * Schema for job deployment configuration
 */
export const JobDeploymentSchema = z.object({
  namespace: z.string(),
  releaseName: z.string(),
  deploymentMethod: z.string(),
  cluster: z.string(),
  values: z.string(),
  testProject: z.string(),
  // Optional overrides
  namespaceOverride: z.string().optional(),
  clusterType: z.enum(['openshift', 'aks', 'gke']).optional(),
  setupCommands: z.array(z.string()).optional(),
  upgradeFromVersion: z.string().optional(),
});

export type JobDeployment = z.infer<typeof JobDeploymentSchema>;

/**
 * Schema for job definition
 */
export const JobDefinitionSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
  priority: z.number(),
  patterns: z.array(z.instanceof(RegExp)),
  examples: z.array(z.string()),
  deployments: z.array(JobDeploymentSchema),
  requiredEnvVars: z.array(z.string()).optional(),
  requiredTools: z.array(z.string()).optional(),
  setupCommands: z.array(z.string()).optional(),
});

export type JobDefinition = z.infer<typeof JobDefinitionSchema>;

/**
 * Centralized job definitions
 * This eliminates code duplication and makes jobs data-driven
 */
export const JOB_DEFINITIONS: Record<string, JobDefinition> = {
  'ocp-nightly': {
    name: 'OCP Nightly',
    type: 'ocp-nightly',
    description: 'OpenShift nightly testing with multiple deployments',
    priority: 50,
    patterns: [/nightly/i, /e2e-tests-nightly/i],
    examples: ['nightly', 'e2e-tests-nightly'],
    deployments: [
      {
        namespace: 'showcase-ci-nightly',
        releaseName: 'rhdh',
        deploymentMethod: 'helm',
        cluster: 'ocp',
        values: 'values_showcase.yaml',
        testProject: 'showcase-ci-nightly',
      },
      {
        namespace: 'showcase-rbac-nightly',
        releaseName: 'rhdh-rbac',
        deploymentMethod: 'helm',
        cluster: 'ocp',
        values: 'values_showcase-rbac.yaml',
        testProject: 'showcase-rbac-nightly',
      },
      {
        namespace: 'showcase-runtime',
        releaseName: 'rhdh',
        deploymentMethod: 'helm',
        cluster: 'ocp',
        values: 'values_showcase.yaml',
        testProject: 'showcase-runtime',
      },
    ],
  },

  'aks-helm': {
    name: 'AKS Helm',
    type: 'aks-helm',
    description: 'Azure Kubernetes Service with Helm deployment',
    priority: 90,
    patterns: [/(aks|azure).*helm/i],
    examples: ['aks-helm-nightly', 'e2e-tests-aks-helm'],
    deployments: [
      {
        namespace: 'showcase-k8s-ci-nightly',
        releaseName: 'rhdh',
        deploymentMethod: 'helm',
        cluster: 'aks',
        values: 'values_showcase.yaml',
        testProject: 'showcase-k8s-ci-nightly',
      },
      {
        namespace: 'showcase-rbac-k8s-ci-nightly',
        releaseName: 'rhdh-rbac',
        deploymentMethod: 'helm',
        cluster: 'aks',
        values: 'values_showcase-rbac.yaml',
        testProject: 'showcase-rbac-k8s-ci-nightly',
      },
    ],
  },

  'gke-operator': {
    name: 'GKE Operator',
    type: 'gke-operator',
    description: 'Google Kubernetes Engine with Operator deployment',
    priority: 90,
    patterns: [/(gke|gcp|google).*operator/i],
    examples: ['gke-operator-nightly', 'e2e-tests-gke-operator'],
    deployments: [
      {
        namespace: 'showcase',
        releaseName: 'rhdh',
        deploymentMethod: 'operator',
        cluster: 'gke',
        values: 'values_showcase.yaml',
        testProject: 'showcase',
      },
      {
        namespace: 'showcase-rbac',
        releaseName: 'rhdh-rbac',
        deploymentMethod: 'operator',
        cluster: 'gke',
        values: 'values_showcase-rbac.yaml',
        testProject: 'showcase-rbac',
      },
    ],
  },

  'ocp-pull': {
    name: 'OCP Pull Request',
    type: 'ocp-pull',
    description: 'OpenShift pull request validation',
    priority: 70,
    patterns: [/pull(-request)?/i],
    examples: ['pull-ci-main', 'pull-request-test'],
    deployments: [
      {
        namespace: process.env.NAME_SPACE || 'showcase',
        releaseName: 'rhdh',
        deploymentMethod: 'helm',
        cluster: 'openshift',
        values: 'values_showcase.yaml',
        testProject: 'showcase',
      },
      {
        namespace: process.env.NAME_SPACE_RBAC || 'showcase-rbac',
        releaseName: 'rhdh-rbac',
        deploymentMethod: 'helm',
        cluster: 'openshift',
        values: 'values_showcase-rbac.yaml',
        testProject: 'showcase-rbac',
      },
    ],
  },

  'ocp-operator': {
    name: 'OCP Operator',
    type: 'ocp-operator',
    description: 'OpenShift with Operator deployment',
    priority: 60,
    patterns: [/operator/i],
    examples: ['operator-nightly', 'e2e-tests-operator'],
    deployments: [
      {
        namespace: process.env.NAME_SPACE || 'showcase-operator',
        releaseName: 'rhdh',
        deploymentMethod: 'operator',
        cluster: 'openshift',
        values: 'values_showcase.yaml',
        testProject: 'showcase',
      },
      {
        namespace: process.env.NAME_SPACE_RBAC || 'showcase-rbac-operator',
        releaseName: 'rhdh-rbac',
        deploymentMethod: 'operator',
        cluster: 'openshift',
        values: 'values_showcase-rbac.yaml',
        testProject: 'showcase-rbac',
      },
    ],
  },

  'ocp-upgrade': {
    name: 'OCP Upgrade',
    type: 'ocp-upgrade',
    description: 'OpenShift upgrade testing',
    priority: 80,
    patterns: [/upgrade/i],
    examples: ['upgrade-nightly', 'helm-upgrade'],
    requiredEnvVars: ['HELM_CHART_URL', 'CHART_VERSION_BASE'],
    deployments: [
      {
        namespace: process.env.NAME_SPACE || 'showcase-upgrade-nightly',
        releaseName: 'rhdh',
        deploymentMethod: 'helm-upgrade',
        cluster: 'openshift',
        values: 'values_showcase.yaml',
        testProject: 'showcase-upgrade',
        upgradeFromVersion: process.env.CHART_VERSION_BASE,
      },
    ],
  },

  'aks-operator': {
    name: 'AKS Operator',
    type: 'aks-operator',
    description: 'Azure Kubernetes Service with Operator deployment',
    priority: 90,
    patterns: [/(aks|azure).*operator/i],
    examples: ['aks-operator-nightly', 'e2e-tests-aks-operator'],
    requiredTools: ['az'],
    setupCommands: ['az login --service-principal', 'az aks get-credentials'],
    deployments: [
      {
        namespace: 'showcase-k8s-operator',
        releaseName: 'rhdh',
        deploymentMethod: 'operator',
        cluster: 'aks',
        values: 'values_showcase.yaml',
        testProject: 'showcase',
      },
      {
        namespace: 'showcase-rbac-k8s-operator',
        releaseName: 'rhdh-rbac',
        deploymentMethod: 'operator',
        cluster: 'aks',
        values: 'values_showcase-rbac.yaml',
        testProject: 'showcase-rbac',
      },
    ],
  },

  'gke-helm': {
    name: 'GKE Helm',
    type: 'gke-helm',
    description: 'Google Kubernetes Engine with Helm deployment',
    priority: 90,
    patterns: [/(gke|gcp|google).*helm/i],
    examples: ['gke-helm-nightly', 'e2e-tests-gke-helm'],
    requiredTools: ['gcloud'],
    setupCommands: [
      'gcloud auth activate-service-account',
      'gcloud container clusters get-credentials',
    ],
    deployments: [
      {
        namespace: 'showcase-k8s-helm',
        releaseName: 'rhdh',
        deploymentMethod: 'helm',
        cluster: 'gke',
        values: 'values_showcase.yaml',
        testProject: 'showcase',
      },
      {
        namespace: 'showcase-rbac-k8s-helm',
        releaseName: 'rhdh-rbac',
        deploymentMethod: 'helm',
        cluster: 'gke',
        values: 'values_showcase-rbac.yaml',
        testProject: 'showcase-rbac',
      },
    ],
  },

  'auth-providers': {
    name: 'Auth Providers',
    type: 'auth-providers',
    description: 'Authentication providers testing',
    priority: 100,
    patterns: [/e2e-tests-auth-providers-nightly/i],
    examples: ['e2e-tests-auth-providers-nightly'],
    setupCommands: ['bash /tmp/install-rhdh-catalog-source.sh --install-operator rhdh'],
    deployments: [
      {
        namespace: 'showcase-auth-providers',
        releaseName: 'rhdh-auth-providers',
        deploymentMethod: 'operator',
        cluster: 'openshift',
        values: 'values_showcase-auth-providers.yaml',
        testProject: 'auth-providers',
      },
    ],
  },
};

/**
 * Get job definition by type
 */
export function getJobDefinition(jobType: string): JobDefinition | undefined {
  return JOB_DEFINITIONS[jobType];
}

/**
 * Get all job types
 */
export function getAllJobTypes(): string[] {
  return Object.keys(JOB_DEFINITIONS);
}

/**
 * Get all job mappings for pattern matching
 */
export function getJobMappings(): Array<{
  pattern: RegExp;
  jobType: string;
  priority: number;
  description: string;
  examples: string[];
}> {
  return Object.values(JOB_DEFINITIONS).map((job) => ({
    pattern: job.patterns[0], // Use first pattern as primary
    jobType: job.type,
    priority: job.priority,
    description: job.description,
    examples: job.examples,
  }));
}
