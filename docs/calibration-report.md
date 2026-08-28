# FlowSense v2 scoring calibration report

- Date: 2026-08-28
- Audited baseline: `3ce54703379f618e1007e2a0bd85b6386b472d97`
- Current score payload: `v2.score.1`
- Current rubric: `v2`

## Scope and method

This is a read-only calibration investigation. It does not propose a new score scale and does not
change scoring constants, weights, thresholds, provider prompts, schemas, migrations, UI, or stored
results.

The review covered the six category evaluators, mode rubrics, score assembler, provider-output
validation, tests, and the checked-in generated calibration corpus. It ran
`npm run check:scoring-calibration`, which uses generated text and timelines, makes no provider or
network calls, and compares the output with checked-in baselines. No production transcript, prompt,
custom context, audio, or other user content was read.

## Executive conclusion

The calibration concern is real, but the existing evidence is narrower than labels such as
“poorly structured” or “grammatical mistakes” suggest. The corpus currently gives:

| Generated case               | Overall score in General Practice | Category movement   |
| ---------------------------- | --------------------------------: | ------------------- |
| Strong response              |                               100 | None                |
| Fluent but poorly structured |                                96 | Structure 18 to 14  |
| Filler-heavy                 |                                95 | Fluency 22 to 17    |
| Rushed                       |                                96 | Fluency 22 to 18    |
| Slow with a long pause       |                                90 | Fluency 22 to 12    |
| Grammatical mistakes         |                                97 | Grammar 12 to 9     |
| Vague vocabulary             |                                99 | Vocabulary 12 to 11 |
| Monotone                     |                                84 | Delivery 16 to 0    |
| Unclear-pronunciation proxy  |                                97 | Clarity 20 to 17    |

These outputs show weak separation for isolated filler, pace, Structure, Grammar, and Vocabulary
findings. They do not show that a broadly weak response must score 95 to 99. Most fixtures inject one
problem and make every other category perfect. The “poorly structured” case even reuses the exact
strong transcript and supplies one failed Structure check. The Grammar case has one error, and the
Vocabulary case has one vague word.

The main causes are:

1. The current corpus is a deterministic drift detector, not a sufficient calibration corpus.
2. Fluency averages four signals equally, so one extreme problem is diluted by three healthy ones.
3. Content findings use one coarse deduction scale for every category and check.
4. The content-provider rubric does not define pass/fail and severity boundaries precisely enough.
5. Safe parser exclusions can turn unusable provider findings into a checked category with no
   deductions.
6. Delivery scores pitch variation only; it does not yet score the amplitude measurement it retains.
7. Mode weights bound an isolated category's impact, and per-category rounding quantizes small
   deductions, but the assembler is not broken.

This is not release-blocking. It is a material post-release product-trust risk and should be addressed
before presenting the number as highly precise or making comparative claims.

## Category assessment

### Fluency: too forgiving for one severe dimension

Fluency is the unweighted mean of filler rate, mid-sentence pause burden, articulation pace, and time
to first word. One signal at zero with the other three at one therefore leaves the category at 0.75.

- Three fillers in a 14-word fixture produce 21.4 fillers per 100 words and a zero filler
  subcomponent. Fluency still earns 17 of 22 points, and the response scores 95.
- A generated articulation rate of about 361 words per minute receives the fast-pace floor of 0.35.
  Averaging that with three perfect signals produces Fluency 0.8375, or 18 of 22 points, and a 96
  overall result.
- Restarts and backtracks are measured but are not scored. That is sensible for occasional
  self-correction, but the corpus does not cover repeated fragmentation.
- Short or excluded gaps can avoid pause burden, while pace correctly uses speaking time so silence is
  not deducted twice. This preserves the double-counting invariant but leaves an untested range of
  frequent subthreshold stalls.

The primary issue is signal aggregation and the pace floors. Fluency's mode weight is only an
amplifier. The assembler is applying the resulting component correctly.

### Clarity: not proven too forgiving

Clarity v1 measures recognition and recording evidence, not accent or native similarity. Its scored
component is one minus the proportion of recognized words below confidence 0.75. Audio level and
speech-to-noise ratio determine whether the evidence is usable, but do not change the score after the
minimum evidence gate is passed.

The current corpus does not justify stricter Clarity thresholds:

- The unclear-pronunciation fixture has only two low-confidence words out of fourteen. Its 17 of 20
  points follows directly from that limited evidence.
- Completely unrecognized spans are not directly represented in the denominator, so high-confidence
  but incomplete recognition remains a possible blind spot.
- At global uncertainty of 60 percent or more, the result becomes `not_checked` instead of inventing a
  deduction. This discontinuity is conservative and prevents unreliable ASR from judging the user.
- Pronunciation-provider evidence is intentionally informational and does not alter Clarity v1.

Clarity may over-credit some incomplete recognition, but tightening it without diverse, ethically
usable recordings risks measuring ASR behavior, accent, or recording conditions instead of
intelligibility.

### Vocabulary: the weakest score separation

A `minor` content finding reduces a category component by 0.10. The vague-Vocabulary fixture contains
one minor finding on one word. At the 12-point General Practice weight, 0.90 rounds to 11 points, so
the overall score falls by only one point to 99. Vocabulary is weighted at 12 or 14 points in every
mode, and this same case scores 99 in all four modes.

The current result is mathematically consistent for one isolated vague word, but the fixture does not
test sustained vague wording, repeated imprecision, prompt mismatch, or whether plain but precise
language remains fully credited. Its label overstates the weakness it contains.

### Grammar: forgiving and under-tested

The Grammar fixture contains one clear subject-verb agreement error. A `clear` finding reduces the
component by 0.25, leaving Grammar at 9 of 12 points and the overall result at 97. Presentation gives
Grammar only 10 possible points, so the equivalent case scores 98 there.

This is not evidence that a response with several recurring grammatical errors would also score 97.
The corpus has no multi-error case and no counterexamples for dialect variation, speech fragments,
or low-confidence ASR spans. Grammar must remain limited to clear, evidence-backed response-level
errors rather than stylistic preferences.

### Structure: too forgiving for major whole-response failures, but the fixture is misleading

Structure uses seven checks, but every `minor` or `clear` failure receives the same 0.10 or 0.25
component reduction. One clear failure therefore leaves Structure at 75 percent whether it represents
limited repetition or a major problem such as not answering the prompt.

The current “fluent but poorly structured” case is not a genuine poor-Structure transcript. It uses
the strong transcript and hand-injects one clear `logical_progression` failure. It scores 96 in General
Practice and 95 to 97 across modes. This proves the effect of one clear Structure finding; it does not
validate the detector's treatment of a non-answer, absent main point, topic drift, thin support, or
incomplete response.

Any later change must preserve semantic precedence. For example, an unanswered prompt, missing main
point, and missing support may all describe one whole-response problem and must not be stacked as
three independent deductions.

### Delivery: good monotony separation, incomplete coverage

Pure monotony is not too forgiving in the current generated case. Flat pitch produces a zero Delivery
component and lowers the General Practice result to 84. Depending on mode weight, the same component
produces an overall score from 80 to 88.

Delivery is nevertheless too narrow to establish broader trust:

- The current component equals the robust pitch-spread component only.
- Amplitude variation is measured and displayed but does not affect the score.
- A synthetic pitch sequence that alternates sharply every 50 milliseconds earns full Delivery. That
  is useful for deterministic testing but is not evidence of natural or useful emphasis.
- Pitch validity checks do not establish representative coverage across the full response.
- An opt-in next evaluator includes voiced-volume stability, but it is not selected in production and
  should not be promoted without natural-recording calibration. Stability alone is also not the same
  as purposeful energy or emphasis.

Delivery can therefore give full points to pitch-varied but otherwise ineffective vocal behavior,
even though it handles the narrow monotony case strongly.

## Cause analysis

### Category weights

The weights total exactly 100 in every mode and reflect legitimate mode emphasis. They constrain how
far an isolated category can move the overall score, but they are not the primary defect.

Applying the current single-defect components across all modes gives these overall ranges:

| Case                           | Overall range across modes |
| ------------------------------ | -------------------------: |
| One clear Structure failure    |                   95 to 97 |
| Extreme isolated filler signal |                   94 to 96 |
| Extreme rushed pace            |                   96 to 97 |
| One clear Grammar finding      |                   97 to 98 |
| One minor Vocabulary finding   |                         99 |
| Zero Delivery component        |                   80 to 88 |

A synthetic compound vector of Fluency 0.50, Clarity 1.00, Vocabulary 0.60, Grammar 0.50, Structure
0.50, and Delivery 0.25 assembles to roughly 56 to 59 across the four modes. The assembler can
separate scores when multiple evaluators actually move.

### Category thresholds and aggregation

This is a demonstrated cause for Fluency. Equal averaging makes a single severe signal contribute
only one quarter of the category, while the pace component has nonzero floors even at extreme rates.

For content categories, the larger issue is the universal severity mapping: `minor` subtracts 0.10
and `clear` subtracts 0.25 regardless of category or check. This is simple and bounded, but it treats
qualitatively different failures as having identical magnitude.

### Content-provider rubric

This is a plausible but not yet measured cause. The system prompt names the seven Structure checks and
the permitted Grammar and Vocabulary findings, but does not operationally define:

- the difference between `minor` and `clear`;
- when thin support fails `relevant_support`;
- when an implicit or late point fails `main_point`;
- how repeated Grammar or Vocabulary patterns should be represented;
- how much drift or repetition constitutes failure;
- how mode changes the interpretation of otherwise shared categories.

The example response shape shows six of seven Structure checks passing, which may anchor output toward
passes. Provider transport is configured for structured, lower-variance output with JSON mode and
temperature zero, but those settings do not guarantee identical model output. The local calibration
corpus bypasses the provider entirely, so it cannot confirm or reject provider generosity.

### Parser acceptance and evidence safety

The parser correctly drops unknown, malformed, unanchored, low-confidence, overlapping, and
mechanically counted findings. This prevents unsafe or duplicate deductions. However, a provider
section with a nonempty findings array can have every finding dropped and still become a checked
category with component 1. The existing tests explicitly preserve that behavior.

This can make unusable provider evidence look perfect. It should not be “fixed” by charging users for
invalid evidence. A later provider-contract experiment can test whether an all-rejected section should
trigger one retry and then become `not_checked`, while retaining fail-in-the-user's-favor behavior.

The parser also cannot determine whether a grammatically anchored finding is linguistically correct.
That remains a provider-quality and reviewed-corpus problem.

### Score assembly and rounding

The assembler is correct:

- it converts category components to weighted points;
- it rounds each category once;
- it sums the stored category points;
- it returns no overall score if any category is not checked or unavailable;
- it never treats missing provider or capture evidence as perfect.

Per-category rounding can hide or add a fraction of a point and makes a minor 12-point finding cost one
point. It cannot explain 95 to 99 scores on its own.

### Test fixture baselines

This is the largest evidence-quality gap. The corpus currently:

- runs every case in General Practice only;
- reuses one short transcript for most cases;
- has no prompt in its fixture contract;
- hand-authors content-provider output and never calls `runV2ContentEvaluation`;
- represents most weak cases with one isolated issue;
- contains no compound weak response;
- asserts exact current snapshots and merely checks that a weak category is lower than strong;
- defines no desired score bands, minimum separation, or scenario ordering.

The command passing means scoring has not drifted from the checked-in numbers. It does not mean those
numbers are well calibrated.

### Practice-prompt design

There is no evidence that library prompt design causes the observed synthetic scores. The corpus does
not include or evaluate a practice prompt. Prompt specificity may influence what a content provider can
assess in live use, but that question was deliberately not investigated with private production
content. The provider's scoring instructions, which are separate from user-facing practice prompts,
remain a calibration hypothesis for Phase 2.

## Safe synthetic scenarios and reasonable category movement

These are proposed corpus inputs, not production examples and not new score targets.

| Scenario                     | Safe synthetic input or setup                                                                                                                                                                       | Categories that should move                                                                                        | Categories that should remain independent                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strong response              | “I would spend the afternoon at the park, walk the lake trail, and read for an hour because quiet outdoor time helps me reset.” Use healthy timing, clear recognition, and natural vocal variation. | None should be forced down.                                                                                        | Plain, precise wording must receive full Vocabulary. An intelligible accent must not reduce Clarity.                                                                                                            |
| Fluent but poorly structured | “The park closes at eight. I bought a bicycle last year. There are many options. My free afternoon would be outside, and anyway reading is useful, so that is it.” Deliver it smoothly.             | Structure should move materially for an unclear main point, weak progression, thin support, and independent drift. | Fluency can remain high. Grammar and Vocabulary should move only for their own evidence. Related Structure checks must not double-count one problem.                                                            |
| Filler-heavy                 | “Um, I would, um, spend it at the park because, you know, it helps me reset.”                                                                                                                       | Fluency should move materially for the filler rate.                                                                | Vocabulary must not charge the filler spans again. Other categories should remain stable if their own evidence is healthy.                                                                                      |
| Vague vocabulary             | “I would do some things somewhere nice because it is good and stuff. It would make things better.”                                                                                                  | Vocabulary should move for several distinct, evidence-backed vague spans.                                          | Grammar can remain high. Structure should move only for independent lack of support, not the same vague words.                                                                                                  |
| Grammatically weak           | “I goes to the park because the paths is quiet, and yesterday I walk there. The trees makes it calm.”                                                                                               | Grammar should move for several distinct, high-confidence spans.                                                   | Structure and Vocabulary can remain high. Low-confidence ASR spans must be ignored rather than charged.                                                                                                         |
| Monotone or low delivery     | Use the strong transcript with flat pitch. In a separate case, use varied pitch with independently validated weak energy or emphasis evidence.                                                      | Delivery should move sharply for flat pitch and only for other vocal signals that are measured reliably.           | Content categories should match the strong case. Pace must not be deducted again under Delivery.                                                                                                                |
| Rushed                       | Use the strong transcript on a compressed timeline above 220 articulation words per minute.                                                                                                         | Fluency should move materially for pace.                                                                           | Delivery should move only if separate prosodic evidence supports it. Content should remain unchanged unless ASR evidence becomes unreliable, in which case affected checks should be `not_checked` or excluded. |

The corpus should also include compound cases. A user may speak fluently while being vague and
unstructured, or use fillers while making several grammatical errors. Those cases are necessary to
test meaningful overall separation without manufacturing deductions across unrelated categories.

## Low-risk improvements for later work

1. Replace misleading weak fixture text with genuinely weak, generated responses.
2. Add multi-error Grammar, repeated-vagueness Vocabulary, multi-dimensional Structure,
   repeated-fragmentation, subthreshold-stall, sparse-pitch, and pitch-varied/low-energy cases. The
   fragmentation case should test whether evidence distinguishes repeated disruption from an
   occasional useful self-correction; it should not assume every restart deserves a deduction.
3. Run every applicable component vector through all four mode rubrics.
4. Add desired score ranges, minimum deltas from strong, and scenario ordering in addition to exact
   drift snapshots. Review these expectations before writing implementation changes.
5. Add fairness counterexamples: plain but precise wording, valid dialect variation, intelligible
   second-language accents, deliberate pauses, and self-correction that improves clarity.
6. Add a provider-contract corpus using only safe synthetic prompts and transcripts. Compare expected
   checks, accepted findings, rejected findings, and severity distributions.
7. Define explicit pass/fail and `minor`/`clear` semantics for each content check in a new detector
   version, after the corpus has reviewed expectations.
8. Test an evidence-sufficiency rule where a provider section containing findings but yielding zero
   valid evidence is retried and then becomes `not_checked`, never a deduction, if it remains invalid.
9. Keep score language tied to the individual response and the available evidence. Avoid benchmarks,
   ability labels, or claims of precision the calibration cannot support.
10. Extend privacy-safe monitoring to score distributions by immutable version, mode, category,
    `not_checked` rate, and provider retry outcome. Do not collect response content for this purpose.

## High-risk changes not to make casually

- Reweight categories merely to widen the overall score distribution.
- Change thresholds, weights, or deduction magnitudes under the existing persisted score/rubric
  version.
- Recalculate or reinterpret historical attempts.
- Add hard overall-score caps based on the weakest category without a reviewed corpus.
- Increase deductions for malformed, missing, unanchored, or low-confidence provider evidence.
- Let a model provide an unvalidated holistic numeric score.
- Penalize response length alone or charge one absence under several Structure checks.
- Charge fillers, pace, pauses, or one transcript span under more than one category.
- Treat plain language, speech fragments, dialect variation, vocabulary “level,” accent, or native
  similarity as deficiencies.
- Tighten ASR confidence or pronunciation rules without diverse-speaker, legally usable audio.
- Promote the experimental Delivery-next evaluator without realistic capture calibration.
- Change provider instructions, parser policy, mechanical thresholds, and weights in one release. That
  would make the source of any score movement impossible to identify.

## Phased recommendation

### Phase 1: tests and corpus only

Make no production scoring changes. Build a reviewed, generated corpus with:

- realistic prompts and genuinely strong, single-defect, and compound responses;
- all four modes and varied response lengths;
- deterministic timing, confidence, pitch, amplitude, and provider-output fixtures;
- explicit expected category ranges, minimum separation, and ordering;
- counterexamples that protect plain language, dialects, intelligible accents, and appropriate pauses;
- cases where every provider finding is rejected by evidence validation.

This phase should distinguish a single minor issue from a broadly weak response rather than expecting
one isolated word or error to produce a low overall score.

Phase 1 is implemented as a separate reviewed-range layer alongside the original exact drift corpus.
It contains 18 generated fixtures: four mode-specific strong anchors, nine weakness scenarios, and
five fairness counterexamples. Run `npm run check:scoring-calibration` to inspect both layers.

Reviewed ranges use normalized category scores from 0 through 100. `INSIDE` is within the inclusive
range, `ABOVE` is more generous, `BELOW` is harsher, and `UNAVAILABLE` means the generated evidence did
not produce a score. Only `strict` misses fail the command. `broad` and `informational` misses remain
visible observations and do not force scoring changes. The generated content findings are
hand-authored, so this layer does not test whether the live provider would detect the same findings.

### Phase 2: provider rubric and output calibration

Using only the reviewed synthetic corpus, evaluate one provider-instruction change at a time:

- define pass/fail boundaries for every Structure check;
- define `minor` and `clear` with concrete, response-level examples;
- specify how recurring Grammar and Vocabulary patterns are represented;
- remove pass-biased examples if the corpus shows anchoring;
- define sufficient valid evidence for a checked content category;
- decide whether all-rejected findings should cause one retry and then `not_checked`.

Retain transcript anchoring, ASR-confidence exclusions, fail-in-the-user's-favor behavior, and
double-count prevention. Version the detector contract if its meaning changes.

### Phase 3: versioned scoring-threshold changes

Only after Phases 1 and 2 establish stable evidence, test scoring changes one category at a time:

1. Evaluate floor-aware or nonlinear Fluency aggregation so one extreme signal is not automatically
   diluted by three perfect signals.
2. Evaluate check-specific content magnitude while preserving semantic precedence.
3. Evaluate representative pitch coverage and independently reliable Delivery signals.
4. Revisit mode weights and rounding only after evaluator changes are understood.

Any selected change needs new immutable score, rubric, detector, or evaluator versions as applicable.
Historical snapshots must remain authoritative and must never be recalculated.

### Phase 4: privacy-safe production monitoring

After a versioned rollout, monitor aggregate outcomes only:

- category and overall distributions by mode and immutable version;
- proportions at 100 and at or above 90;
- category `not_checked` and unavailable rates;
- content-provider retry and recovery rates;
- old-versus-new shadow comparisons using only legally and ethically usable fixtures or explicitly
  approved data.

Define review and rollback thresholds before rollout. Do not monitor prompt text, transcript text,
private context, raw provider responses, or user identity for calibration.

## Release assessment and recommended next task

No calibration issue found here is release-blocking. Score assembly is deterministic for fixed
evaluator and provider results; the system is bounded, evidence-aware, versioned, and fail-safe when
required evidence is unavailable. Production's primary loop does not depend on changing these
numbers.

The concern remains important for trust. The Phase 1 range output currently reports nonblocking
`ABOVE` observations for filler-heavy and rushed Fluency, plus long-repetitive and off-topic
Structure. Realistic multi-finding Grammar and Vocabulary cases fall inside their reviewed ranges when
the hand-authored detector output supplies each valid finding.

The next calibration task should be **Phase 2 only: use the synthetic corpus to evaluate provider
rubric and output consistency without changing production thresholds or weights**. That work should
remain offline and versioned until a reviewed change is approved.

## Key implementation references

- [Generated calibration corpus](../src/lib/scoring/v2/calibration.ts)
- [Calibration regression tests](../tests/scoring-calibration.test.ts)
- [Phase 1 reviewed fixtures](../fixtures/scoring/phase1-calibration.json)
- [Reviewed-range evaluator](../src/lib/scoring/v2/calibration-reviewed.ts)
- [Reviewed-range tests](../tests/scoring-calibration-reviewed.test.ts)
- [Mode rubrics](../src/lib/scoring/v2/rubrics.ts)
- [Score assembler](../src/lib/scoring/v2/assemble.ts)
- [Fluency evaluator](../src/lib/scoring/v2/fluency.ts)
- [Pace thresholds](../src/lib/scoring/pace.ts)
- [Clarity evaluator](../src/lib/scoring/v2/clarity.ts)
- [Delivery evaluator](../src/lib/scoring/v2/delivery.ts)
- [Content evaluator and parser](../src/lib/scoring/v2/content/evaluate.ts)
- [Content-provider instructions](../src/lib/scoring/v2/content/prompt.ts)
- [Scoring version registry](../src/lib/scoring/v2/registry.ts)
