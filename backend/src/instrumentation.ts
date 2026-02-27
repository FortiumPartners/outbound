export {};

/**
 * OpenTelemetry Instrumentation
 *
 * Must be loaded before any other imports via --import flag.
 * Only starts when OTEL_EXPORTER_OTLP_ENDPOINT is set — otherwise no-op.
 *
 * Handles trace export only. Log export is handled by pino-opentelemetry-transport
 * in the logger configuration, which is more reliable with ESM than the pino
 * instrumentation bridge.
 */

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (otlpEndpoint) {
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { getNodeAutoInstrumentations } = await import(
    '@opentelemetry/auto-instrumentations-node'
  );
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
    '@opentelemetry/semantic-conventions'
  );

  const serviceName = process.env.OTEL_SERVICE_NAME || 'outbound-api';

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: '0.1.0',
  });

  // Parse OTEL_EXPORTER_OTLP_HEADERS (format: "Key=Value,Key2=Value2")
  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS || '';
  const headers: Record<string, string> = {};
  for (const pair of rawHeaders.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      headers[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
  }

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
      headers,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable log sending -- handled by pino-opentelemetry-transport in logger
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Filter health check endpoints from HTTP traces
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            return req.url === '/health' || req.url === '/healthz';
          },
        },
      }),
    ],
  });

  sdk.start();
  console.log(`[otel] Traces enabled -> ${otlpEndpoint}`);

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err) => console.error('[otel] SDK shutdown error', err));
  });
}
