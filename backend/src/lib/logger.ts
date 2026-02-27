import pino from 'pino';
import type { TransportTargetOptions } from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || 'info';

function buildTransport(): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
  if (isDevelopment) {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  // Production: send to both stdout and OTel (if configured)
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!otlpEndpoint) return undefined; // plain JSON to stdout

  const targets: TransportTargetOptions[] = [
    // stdout for Render log viewer
    { target: 'pino/file', options: { destination: 1 }, level: 'info' },
    // OTel log export for Grafana Cloud Loki
    {
      target: 'pino-opentelemetry-transport',
      options: {
        resourceAttributes: {
          'service.name': 'outbound-api',
          'service.version': '0.1.0',
        },
        loggerName: 'outbound-api',
        serviceVersion: '0.1.0',
      },
      level: 'info',
    },
  ];

  return { targets };
}

export const logger: pino.Logger = pino({
  level: isDevelopment ? 'debug' : logLevel,
  transport: buildTransport(),
  base: {
    env: process.env.NODE_ENV,
    service: 'outbound-api',
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    censor: '[REDACTED]',
  },
});

export type Logger = pino.Logger;
