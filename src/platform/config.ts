/**
 * Reject wildcard CORS when credentials are enabled. Other origins are denied.
 * Production must use explicit HTTPS domains controlled by the deployment.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (items.includes('*')) throw new Error('Wildcard CORS is forbidden for credentialed requests');
  for (const item of items) {
    const url = new URL(item);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.origin !== item) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain origin values only');
    }
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('Production CORS origins must be HTTPS');
    }
  }
  return [...new Set(items)];
}
export function parsePort(raw: string | undefined): number {
  const port = raw === undefined ? 3001 : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  return port;
}
