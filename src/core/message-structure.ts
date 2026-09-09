import type { MessageStructureResult, TagMismatch } from './types.js'

const SIMPLE_PLACEHOLDER_PATTERN = /\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}/g
const ICU_PLACEHOLDER_PATTERN = /\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*,/g
const TAG_PATTERN = /<\s*\/?\s*([A-Za-z][A-Za-z0-9:-]*)/g

function placeholderNames(value: unknown): Set<string> {
  const text = String(value ?? '')
  const names = new Set<string>()
  for (const pattern of [SIMPLE_PLACEHOLDER_PATTERN, ICU_PLACEHOLDER_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]
      if (name) names.add(name)
    }
  }
  return names
}

function tagNameCounts(value: unknown): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of String(value ?? '').matchAll(TAG_PATTERN)) {
    const name = (match[1] as string).toLowerCase()
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort()
}

export function validateMessageStructure(
  sourceText: string,
  translatedText: string,
): MessageStructureResult {
  const sourcePlaceholders = placeholderNames(sourceText)
  const targetPlaceholders = placeholderNames(translatedText)
  const missingPlaceholders = sortedDifference(sourcePlaceholders, targetPlaceholders)
  const unexpectedPlaceholders = sortedDifference(targetPlaceholders, sourcePlaceholders)

  const sourceTags = tagNameCounts(sourceText)
  const targetTags = tagNameCounts(translatedText)
  const tagMismatches: TagMismatch[] = []
  for (const name of new Set([...sourceTags.keys(), ...targetTags.keys()])) {
    const expected = sourceTags.get(name) ?? 0
    const actual = targetTags.get(name) ?? 0
    if (expected !== actual) tagMismatches.push({ tag: name, expected, actual })
  }
  tagMismatches.sort((left, right) => left.tag.localeCompare(right.tag))

  const problems: string[] = []
  if (unexpectedPlaceholders.length > 0) {
    problems.push(
      `introduces unknown placeholder(s) ${unexpectedPlaceholders.map((name) => `{${name}}`).join(', ')}`,
    )
  }
  if (missingPlaceholders.length > 0) {
    problems.push(
      `drops placeholder(s) ${missingPlaceholders.map((name) => `{${name}}`).join(', ')}`,
    )
  }
  for (const mismatch of tagMismatches) {
    problems.push(
      `uses <${mismatch.tag}> ${mismatch.actual} time(s) instead of ${mismatch.expected}`,
    )
  }

  return {
    valid: problems.length === 0,
    missingPlaceholders,
    unexpectedPlaceholders,
    tagMismatches,
    problems,
  }
}
