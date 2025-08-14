const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  RuntimeNodeInstrumentation,
} = require('@opentelemetry/instrumentation-runtime-node');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
const { HostMetrics } = require('@opentelemetry/host-metrics');
const { metrics } = require('@opentelemetry/api');

// Metrics will be exported to localhost:9464/metrics
const prometheus = new PrometheusExporter();
const sdk = new NodeSDK({
  metricReader: prometheus,
  instrumentations: [
    getNodeAutoInstrumentations(),
    new RuntimeNodeInstrumentation(),
  ],
});

sdk.start();

const hostMetrics = new HostMetrics({
  meterProvider: metrics.getMeterProvider(),
});
hostMetrics.start();
