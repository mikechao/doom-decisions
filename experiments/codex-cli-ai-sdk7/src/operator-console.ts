import { stripVTControlCharacters } from 'node:util';
import { createConsola } from 'consola/basic';

// BasicReporter routes info to stdout and warnings/errors to stderr. Bind BOTH
// to stderr explicitly; no console/std wrapping, colors, timers or deferred logs.
export function createOperatorConsole(stderr: NodeJS.WriteStream = process.stderr) {
  return createConsola({ stdout: stderr, stderr, level: 3, throttle: 0,
    formatOptions: { colors: false, date: false } });
}

// Only the two scoped advisory fields go through here, never the base prompt,
// transcripts, notes, errors, paths or image data. Indent every physical line so
// advisory text cannot impersonate an operator milestone.
export function displayGuidance(value: string) {
  const safe = stripVTControlCharacters(value)
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/(?:https?:\/\/|data:)[^\s]+|(?:[A-Za-z]:\\|\/|~\/)[^\s]+/gi, '[redacted location]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{64}\b/gi, '[redacted ID]')
    .replace(/\b(?:sk-|sess-|key-)[\w-]+|\bBearer\s+\S+|\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '[redacted credential]')
    .replace(/\s+/g, ' ').trim();
  return `\n    ${safe.slice(0, 480)}${safe.length > 480 ? ' [truncated]' : ''}`;
}
