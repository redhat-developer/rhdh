export const DEFAULT_CATALOG_INFO_YAML = (
  componentName: string,
  projectSlug: string,
  user: string,
) => `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${componentName}
  annotations:
    github.com/project-slug: ${projectSlug}
spec:
  type: other
  lifecycle: unknown
  owner: user:default/${user}
`;

export const UPDATED_CATALOG_INFO_YAML = (
  componentName: string,
  projectSlug: string,
  labels: string,
  user: string,
) => `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: ${componentName}
  annotations:
    github.com/project-slug: ${projectSlug}
  labels:
    ${labels.split(";")[0]}
    ${labels.split(";")[1]}
spec:
  type: other
  lifecycle: unknown
  owner: user:default/${user}
`;
