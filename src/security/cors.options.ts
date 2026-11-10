export function createCorsOptions() {
  const origin = process.env.FRONTEND_ORIGIN;
  if (!origin) throw new Error('FRONTEND_ORIGIN is required');

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error('FRONTEND_ORIGIN must be a valid origin');
  }
  if (parsedOrigin.origin !== origin || parsedOrigin.origin === 'null') {
    throw new Error('FRONTEND_ORIGIN must not include a path');
  }

  return {
    origin: (requestOrigin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
      callback(null, requestOrigin === origin);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
    exposedHeaders: ['X-Access-Token'],
  };
}
