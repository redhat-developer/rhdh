import { unstable_ClassNameGenerator as ClassNameGenerator } from "@mui/material/className";

ClassNameGenerator.configure((componentName) => {
  return componentName.startsWith("v5-")
    ? componentName
    : `v5-${componentName}`;
});

export * from "@red-hat-developer-hub/backstage-plugin-global-floating-action-button";
