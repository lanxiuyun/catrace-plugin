export function piSessionUrl(value, sessionId) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid Pi session URL')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !url.searchParams.get('session')) throw new Error('Invalid Pi session URL')
  if ([...url.searchParams.keys()].some((key) => key !== 'session') || url.searchParams.getAll('session').length !== 1) throw new Error('Invalid Pi session URL')
  if (sessionId !== undefined && url.searchParams.get('session') !== sessionId) throw new Error('Pi session URL does not match session ID')
  return url.href
}

export function piNavigation(value, sessionId) {
  if (value === undefined) return { hookPpid: 0 }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Pi navigation')
  if (value.kind === 'web') return { hookPpid: 0, sessionUrl: piSessionUrl(value.url, sessionId) }
  if (value.kind === 'terminal' && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647) return { hookPpid: value.pid }
  throw new Error('Invalid Pi navigation')
}
