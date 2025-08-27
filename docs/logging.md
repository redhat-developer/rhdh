# Logging for RHDH

This document covers logging configuration for Red Hat Developer Hub (RHDH). Logging in RHDH is conducted using the [winston](https://github.com/winstonjs/winston) library. By default, logs of level `debug` are not logged. To enable debug logs, you will need to set the environment variable `LOG_LEVEL` to `debug` in your deployment.

## Prerequisites

- Kubernetes 1.19+
- PV provisioner support in the underlying infrastructure


### Helm deployment

You can set the logging level by adding the environment variable in your Helm chart's `values.yaml`, as follows:

```yaml title="values.yaml"
upstream:
  backstage:
    # Other configurations above
    extraEnvVars:
      - name: LOG_LEVEL
        value: debug
```

### Operator-backed deployment

You can set the logging level by adding the environment variable in your Custom Resource, like so:

```yaml title="env var in Custom Resource"
spec:
  # Other fields omitted
  application:
    extraEnvs:
      envs:
        - name: LOG_LEVEL
          value: debug
```

### Openshift Logging Integration

[Openshift Logging](https://docs.redhat.com/en/documentation/openshift_container_platform/4.19/html/logging/index) can be used to monitor Backstage logs. The only requirement is to correctly filter logs in Kibana. A possible filter is using the field `kubernetes.container_name` with operator `is` and value `backstage-backend`.

### Logging with Azure Monitor Container Insights

[Azure Monitor Container Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-log-query#container-logs) can be used to query logs from your Backstage instance. The AKS cluster must have Container Insights configured with container logs turned on. You can then query logs from your Backstage instance by querying from the `ContainerLogV2` table:

```kql
ContainerLogV2
| where ContainerName == "backstage-backend"
| project TimeGenerated, LogMessage
```
