# Setting up Metrics Monitoring and Logging for RHDH

The RHDH provides a `/metrics` endpoint on port `9464` that provides OpenTelemetry metrics about your backstage application. This endpoint can be used to monitor your backstage instance using OpenTelemetry and Grafana.

When deploying RHDH onto a kubernetes cluster with the [RHDH Helm chart](https://github.com/redhat-developer/rhdh-chart) or the [RHDH Operator](https://github.com/janus-idp/operator), monitoring and logging for your RHDH instance can be configured using the following steps.

## Prerequisites

- Kubernetes 1.19+
- PV provisioner support in the underlying infrastructure
- If using the Helm Chart
  - Helm 3.2.0+
  - The [RHDH Helm chart repositories](https://github.com/redhat-developer/rhdh-chart#installing-from-the-chart-repository)

## Metrics Monitoring

### Enabling Metrics Monitoring on Openshift

To enable metrics monitoring on OpenShift, we need to create a `ServiceMonitor` resource in the OpenShift cluster that will be used by Prometheus to scrape metrics from your Backstage instance. For the metrics to be ingested by the built-in Prometheus instances in Openshift, please ensure you enabled [monitoring for user-defined projects](https://docs.openshift.com/container-platform/latest/observability/monitoring/configuring-user-workload-monitoring/preparing-to-configure-the-monitoring-stack-uwm.html).

#### Helm deployment

To enable metrics on Openshift when deploying with the [RHDH Helm chart](https://github.com/redhat-developer/rhdh-chart), you will need to modify the [`values.yaml`](https://github.com/redhat-developer/rhdh-chart/blob/main/charts/backstage/values.yaml) of the Chart.

To obtain the `values.yaml`, you can run the following command:

```bash
helm show values redhat-developer/backstage > values.yaml
```

Then, you will need to modify the `values.yaml` to enable metrics monitoring by setting `upstream.metrics.serviceMonitor.enabled` to true:

```yaml title="values.yaml"
upstream:
  # Other Configurations Above
  metrics:
    serviceMonitor:
      enabled: true
      path: /metrics
      port: http-metrics
```

Then you can deploy the Janus Helm chart with the modified `values.yaml`:

```bash
helm upgrade -i <release_name> redhat-developer/backstage -f values.yaml
```

You can then verify metrics are being captured by navigating to the Openshift Console. Go to `Developer` Mode, change to the namespace the showcase is deployed on, selecting `Observe` and navigating to the `Metrics` tab. Here you can create PromQL queries to query the metrics being captured by OpenTelemetry.
![Openshift Metrics](./images/openshift-metrics.png)

#### Operator-backed deployment

At the moment, the operator does not support creating OpenShift `ServiceMonitor` instances out of the box.

However, you can manually create a `ServiceMonitor` resource for your operator-backed Backstage instance; and it will be used by Prometheus to scrape metrics from your Backstage instance. To do so, please adjust and run the following commands using either `oc` or `kubectl`:

```bash
# make sure to update CR_NAME value accordingly
$ CR_NAME=my-rhdh
$ MY_PROJECT=my-project
$ cat <<EOF > /tmp/${CR_NAME}.ServiceMonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: ${CR_NAME}
  namespace: ${MY_PROJECT}
  labels:
    app.kubernetes.io/instance: ${CR_NAME}
    app.kubernetes.io/name: backstage
spec:
  namespaceSelector:
    matchNames:
      - ${MY_PROJECT}
  selector:
    matchLabels:
      rhdh.redhat.com/app: backstage-${CR_NAME}
  endpoints:
  - port: http-metrics
    path: '/metrics'
EOF
$ oc apply -f /tmp/${CR_NAME}.ServiceMonitor.yaml
```

Similar to the instructions above for a Helm-based deployment, you can then verify metrics are being captured by navigating to the Openshift Console. Go to `Developer` Mode, change to the namespace the showcase is deployed on, selecting `Observe` and navigating to the `Metrics` tab.

### Enabling Metrics Monitoring on Azure Kubernetes Service (AKS)

To enable metrics monitoring for RHDH on Azure Kubernetes Service (AKS), you can use the [Azure Monitor managed service for Prometheus](https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/prometheus-metrics-overview). The AKS cluster will need to have an associated [Azure Monitor workspace](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/prometheus-metrics-enable?tabs=azure-portal).

One method is to configure the metrics scraping of your AKS cluster using the [Azure Monitor _metrics_ add-on](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/prometheus-metrics-scrape-configuration).

The other method is to configure the Azure Monitor _monitoring_ add-on which also allows you to [send Prometheus metrics to the Log Analytics workspace](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-prometheus-logs). These metrics can then be queried using [Log Analytics queries](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-log-query#prometheus-metrics) as well as be visible in a Grafana instance.

In both methods, we can configure the metrics scraping to scrap from pods based on pod Annotations. Follow the steps below depending on how the RHDH application is deployed.

#### Helm deployment

To add annotations to the backstage pod, add the following to the Janus Helm chart `values.yaml`:

```yaml title="values.yaml"
upstream:
  backstage:
    # Other configurations above
    podAnnotations:
      # Other annotations above
      prometheus.io/scrape: 'true'
      prometheus.io/path: '/metrics'
      prometheus.io/port: '9464'
      prometheus.io/scheme: 'http'
```

#### Operator-backed deployment

For an operator-backed deployment, you will need to first create your Custom Resource, then manually add the annotations to the Backstage Pod created by the Operator.

Using `oc` or `kubectl`, you can run the following command:

```bash
# make sure to update CR_NAME value accordingly
$ CR_NAME=my-rhdh
$ oc annotate pods \
    --selector janus-idp.io/app="backstage-${CR_NAME}" \
    prometheus.io/scrape='true' \
    prometheus.io/path='/metrics' \
    prometheus.io/port='9464' \
    prometheus.io/scheme='http'
```

**NOTE**: Please note that these annotations might be lost if the pod has to be recreated by the operator. In this case, you can either add the annotations again or, as an administrator of the operator, change its default configuration.
To have something persistent, if you have access to the namespace where the operator is running (usually `rhdh-operator`, `openshift-operators`, or `backstage-system`), you can do the following, using either `oc` or `kubectl`:

1. Edit the default configuration of the operator:

```bash
# make sure to update OPERATOR_NS accordingly
$ OPERATOR_NS=rhdh-operator
$ oc edit configmap backstage-default-config -n "${OPERATOR_NS}"
```

2. Find the `deployment.yaml` key in the ConfigMap, and add the annotations to the `spec.template.metadata.annotations` field, like so:

```yaml
deployment.yaml: |-
  apiVersion: apps/v1
  kind: Deployment
  # --- truncated ---
  spec:
    template:
      # --- truncated ---
      metadata:
        labels:
          janus-idp.io/app:  # placeholder for 'backstage-<cr-name>'
        # --- truncated ---
        annotations:
          prometheus.io/scrape: 'true'
          prometheus.io/path: '/metrics'
          prometheus.io/port: '9464'
          prometheus.io/scheme: 'http'
  # --- truncated ---
```

3. Save
4. If you already have existing resources created by the operator from existing Custom Resources, you might need to force the operator to recreate the pods, by deleting the corresponding Deployment. For example:

```bash
# make sure to update CR_NAME value accordingly
$ CR_NAME=my-rhdh
$ oc delete deployment --selector app.kubernetes.io/instance="${CR_NAME}"
```

#### Metrics Add-on

For the _metrics_ add-on, we can modify the [`ama-metrics-settings-configmap`](https://github.com/Azure/prometheus-collector/blob/main/otelcollector/configmaps/ama-metrics-settings-configmap.yaml) Config Map and enable pod annotations based scraping for the namespace your showcase instance is in. In the [example Config Map](./configuration_files/ama-metrics-settings-configmap.yaml), change the regex for the `podannotationnamespaceregex` option to match the namespaces you want to scrape from. For more information on how to configure this refer to the [official Azure docs](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/prometheus-metrics-scrape-configuration#customize-metrics-collected-by-default-targets).

Alternatively, we will can instead add/modify the `ama-metrics-prometheus-config` Config Map in the `kube-system` namespace of the AKS cluster to configure custom scrape jobs. In the [example Config Map](./configuration_files/ama-metrics-prometheus-config.yaml), please replace the values of namespace with the namespace you the backstage instance into. For more information on how to configure this refer to the [official Azure docs](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/prometheus-metrics-scrape-configuration#configure-custom-prometheus-scrape-jobs).

To view the metrics, you can create a Grafana instance, [configure an Azure Monitor data source plug-in](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/grafana-plugin#configure-an-azure-monitor-data-source-plug-in) and view the metrics using PromQL queries.

#### Monitoring Add-on

For the _monitoring_ add-on, we will need to add the a modified instance of this [Config Map](https://raw.githubusercontent.com/microsoft/Docker-Provider/ci_prod/kubernetes/container-azm-ms-agentconfig.yaml) to the `kube-system` namespace of the AKS cluster. In the [example Config Map](./configuration_files/container-azm-ms-agentconfig.yaml), please replace the values of namespace with the namespace you deployed the backstage instance into. For more information refer to the [official Azure docs](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-prometheus-logs?tabs=cluster-wide).

To view the metrics, you can create a Grafana instance, [configure an Azure Monitor data source plug-in](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/grafana-plugin#configure-an-azure-monitor-data-source-plug-in) and view the metrics using PromQL queries.

Alternatively, you can use [Log Analytics](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-log-query#prometheus-metrics) to query the metrics using KQL. The following is an example query to get a custom metric for the Backstage instance:

```kql
let custom_metrics = "custom-metric-name";
InsightsMetrics
| where Namespace contains "prometheus"
| where Name == custom_metrics
| extend tags = parse_json(Tags)
| where tostring(tags['app.kubernetes.io/component']) == "backstage"
```

## Logging

Logging in RHDH is conducted using the [winston](https://github.com/winstonjs/winston) library. By default, logs of level `debug` are not logged. To enable debug logs, you will need to set the environment variable `LOG_LEVEL` to `debug` in your deployment.

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

[Openshift Logging](https://access.redhat.com/documentation/en-us/openshift_container_platform/4.13/html/logging/index) can be used to monitor Backstage logs. The only requirement is to correctly filter logs in Kibana. A possible filter is using the field `kubernetes.container_name` with operator `is` and value `backstage-backend`.

### Logging with Azure Monitor Container Insights

[Azure Monitor Container Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/containers/container-insights-log-query#container-logs) can be used to query logs from your Backstage instance. The AKS cluster must have Container Insights configured with container logs turned on. You can then query logs from your Backstage instance by querying from the `ContainerLogV2` table:

```kql
ContainerLogV2
| where ContainerName == "backstage-backend"
| project TimeGenerated, LogMessage
```
