/**
 * Pure JID (Jabber ID) helper functions.
 * No side effects, no filesystem access, no WhatsApp connection.
 */

// Sanitize user-controlled strings that land inside the <channel> XML tag.
export function safeName(s: string | undefined): string | undefined {
  return s?.replace(/[<>\[\]\r\n;]/g, '_')
}

// Strip device suffix (:0, :1, …) to normalise JIDs for comparison.
export function bareJid(jid: string): string {
  const parts = jid.split('@')
  return parts[0].split(':')[0] + '@' + (parts[1] ?? '')
}

// Returns true if the JID is in LID format (@lid domain).
// LID numbers are internal WhatsApp identifiers, NOT phone numbers.
export function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid')
}

// Extract the numeric phone prefix from a JID.
// NOTE: Only use this for display purposes. For identity comparisons,
// use jidMatch() / jidListIncludes() which are domain-aware.
export function jidPhone(jid: string): string {
  return jid.split('@')[0].split(':')[0]
}

// Check whether two JIDs refer to the same user. Domain-aware: @lid and
// @s.whatsapp.net are different identity spaces and never match each other
// even if the numeric parts happen to be equal.
export function jidMatch(a: string, b: string): boolean {
  return bareJid(a) === bareJid(b)
}

// Check whether a list of JIDs contains one matching a given JID.
export function jidListIncludes(list: string[], jid: string): boolean {
  const norm = bareJid(jid)
  return list.some(j => bareJid(j) === norm)
}
