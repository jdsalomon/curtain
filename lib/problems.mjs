// Every failure a phase might survive is one of these. Codes are stable strings;
// skills branch on the code and never parse the prose.
export const CODES = {
  NO_CONFIG: 'NO_CONFIG',
  NOT_RUNNING: 'NOT_RUNNING',
  NOT_ANSWERING: 'NOT_ANSWERING',
  PORT_TAKEN: 'PORT_TAKEN',
  UNCLAIMED_SERVER: 'UNCLAIMED_SERVER',
  START_FAILED: 'START_FAILED',
  NOT_READY: 'NOT_READY',
  NO_PORT_FOUND: 'NO_PORT_FOUND',
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  NODE_TOO_OLD: 'NODE_TOO_OLD',
  // walk
  NO_SUCH_WALK: 'NO_SUCH_WALK',
  WALK_FAILED: 'WALK_FAILED',
  CLEANUP_FAILED: 'CLEANUP_FAILED',
  TARGET_NOT_LOCAL: 'TARGET_NOT_LOCAL',
  MISSING_CHROMIUM: 'MISSING_CHROMIUM',
  MISSING_FFMPEG: 'MISSING_FFMPEG',
  // A later release adds NO_TENANT, when seeding lands.
}

export function problem(code, fields = {}) {
  if (!CODES[code]) throw new Error(`unknown problem code: ${code}`)
  return { code, ...fields }
}

/** Blocking codes stop a phase; the rest are information. Used by exit codes. */
export const BLOCKING = new Set([
  CODES.NO_CONFIG,
  CODES.START_FAILED,
  CODES.NO_PORT_FOUND,
  CODES.UNSUPPORTED_PLATFORM,
  CODES.NODE_TOO_OLD,
  CODES.NO_SUCH_WALK,
  CODES.WALK_FAILED,
  CODES.CLEANUP_FAILED,
  CODES.TARGET_NOT_LOCAL,
  CODES.MISSING_CHROMIUM,
  // MISSING_FFMPEG is information, not a blocker: the webm is still a real
  // recording, and the run that produced it still passed.
])

export function isBlocking(problems) {
  return problems.some((p) => BLOCKING.has(p.code))
}
