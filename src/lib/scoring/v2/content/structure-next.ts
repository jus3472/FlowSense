import type { V2CategoryResult, V2ContentFinding } from '@/lib/scoring/v2/content/contracts'

export const STRUCTURE_PRECEDENCE_VERSION = 'v2.structure-precedence.1' as const

export interface StructureSemanticExclusion {
  kept: string
  excluded: string
  reason: 'same_whole_response_problem'
}

export interface StructurePrecedenceEvaluation {
  version: typeof STRUCTURE_PRECEDENCE_VERSION
  result: V2CategoryResult
  exclusions: readonly StructureSemanticExclusion[]
}

/**
 * A failed answer check makes narrower absence checks indeterminate. A missing
 * main point similarly makes a lack-of-support deduction part of the same
 * whole-response problem. Quote-anchored findings and all other structure
 * checks remain independent.
 */
const WHOLE_RESPONSE_PRECEDENCE: Readonly<Record<string, readonly string[]>> = {
  answered_prompt: ['main_point', 'relevant_support', 'completion'],
  main_point: ['relevant_support'],
}

function isWholeResponse(finding: V2ContentFinding): boolean {
  return finding.quote === null && finding.evidence.length === 0
}

/**
 * Opt-in next-version policy. The existing v2 parser and stored score meaning
 * are unchanged; a later version registry can call this after parsing content.
 */
export function applyStructurePrecedenceVNext(
  result: V2CategoryResult,
): StructurePrecedenceEvaluation {
  if (
    result.category !== 'structure' ||
    result.status !== 'checked' ||
    result.component === null ||
    !Number.isFinite(result.component)
  ) {
    return { version: STRUCTURE_PRECEDENCE_VERSION, result, exclusions: [] }
  }

  const wholeResponseKinds = new Set(
    result.findings.filter(isWholeResponse).map((finding) => finding.kind),
  )
  const excludedBy = new Map<string, string>()
  for (const [kept, exclusions] of Object.entries(WHOLE_RESPONSE_PRECEDENCE)) {
    if (!wholeResponseKinds.has(kept) || excludedBy.has(kept)) continue
    for (const excluded of exclusions) {
      if (wholeResponseKinds.has(excluded) && !excludedBy.has(excluded)) {
        excludedBy.set(excluded, kept)
      }
    }
  }

  const findings = result.findings.filter((finding) => !excludedBy.has(finding.kind))
  const exclusions = [...excludedBy].map(([excluded, kept]) => ({
    kept,
    excluded,
    reason: 'same_whole_response_problem' as const,
  }))
  const totalDeduction = findings.reduce((sum, finding) => sum + finding.deduction, 0)

  return {
    version: STRUCTURE_PRECEDENCE_VERSION,
    result: {
      ...result,
      component: Math.max(0, Math.min(1, 1 - totalDeduction)),
      findings,
      measurements: {
        ...result.measurements,
        semantic_exclusion_count: exclusions.length,
      },
      warnings:
        exclusions.length === 0
          ? result.warnings
          : [
              ...result.warnings,
              ...exclusions.map(
                ({ kept, excluded }) =>
                  `structure.${excluded} was excluded because structure.${kept} already represented the same whole-response problem.`,
              ),
            ],
    },
    exclusions,
  }
}
