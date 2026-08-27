# ADR 0001: Guarded Azure pronunciation assessment spike

## Status

Accepted for a non-production evaluation harness only. Azure Speech Pronunciation Assessment is selected for guarded Task 22 integration exploration. It is not proven reliable for deductions.

## Decision

Use a provider-neutral contract before any vendor adapter. The guarded runtime targets Azure Speech Pronunciation Assessment behind a server-only boundary and uses the documented short-audio REST endpoint only for WAV PCM 16 kHz mono or OGG Opus recordings no longer than 30 seconds. FlowSense commonly stores WebM or MP4 and may record longer responses; those attempts remain explicitly not checked. This task adds no transcoding and no production pronunciation deductions.

The initial runtime locale is conservatively limited to `en-US`. Its request uses Basic dimension with word and phoneme granularity, and does not enable prosody or content assessment. Provider words are sequence-aligned to the stored reference transcript; insertions, omissions, and substitutions remain lexical outcomes rather than pronunciation findings.

Intelligibility is not a provider field in the contract. Fixture expectations may state paired-audio ground truth, such as an intelligible accent case, but an adapter cannot declare a word intelligible or use that assertion as evidence.

Azure is the selected target because its official documentation describes both scripted assessment with reference text and unscripted assessment without one, plus word and phoneme evidence where supported. The guarded implementation uses a directly mockable HTTP transport verified against the official short-audio REST documentation. Azure pricing follows Speech to Text baseline pricing for accuracy, fluency, completeness, and miscue, while prosody is an add-on. Audio and reference text are sensitive response data and require a retention, region, processor, and user-consent review before live use.

The normalized contract keeps word and phoneme timings nullable. A future adapter must verify Azure offset and duration semantics against paired audio. Speechace documents word extents for mapping sounds to letters, not a substitute for confirmed audio timings.

## Provider comparison

| Provider                              | Evidence and constraints                                                                                                                                                                                                                                                                                 | Decision                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure Speech Pronunciation Assessment | Scripted reading requires reference text. Unscripted speaking does not. It can return word and phoneme assessment, but feature availability varies by locale and some features are preview or locale constrained. Its documentation describes accuracy as phoneme similarity to native pronunciation.    | Selected for guarded integration only. Never consume aggregate, native-similarity, fluency, completeness, prosody, or content scores as FlowSense inputs.       |
| Speechace                             | Scripted HTTP endpoint accepts audio plus text and returns word, syllable, phoneme, and stress data. It supports unknown-word inference and lexicon validation. Its public documentation also frames quality against native English pronunciation and offers broad assessment outputs outside this task. | Not selected. Its scripted fit and detailed data are useful comparison evidence, but native-likeness and product-scope risks require the same exclusion policy. |
| Deepgram word confidence              | Deepgram defines word confidence as its estimated probability that a word was transcribed correctly. It is useful for transcript reliability and existing clarity evidence, not phoneme pronunciation.                                                                                                   | Retained only as transcription evidence. It is never a pronunciation accuracy field.                                                                            |

## Safety gates before deductions

No pronunciation deduction can ship until paired-audio validation shows all of the following for every enabled locale and scenario:

1. Human review confirms the word-level evidence is reliable enough for the intended intelligibility claim, including unusual but intelligible pronunciations.
2. A separate lexical alignment test distinguishes match, substitution, insertion, omission, and unsupported words without labeling lexical errors as pronunciation errors.
3. Locale, reference-text, timing, unknown-word, and phoneme-support gaps result in unavailable or not-checked evidence, never a perfect value or deduction.
4. Outage, timeout, malformed-response, and provider-version changes fail closed with no score effect.
5. Native-similarity, accent, dialect detection or enforcement, aggregate pronunciation, fluency, completeness, prosody, content, proficiency, and status scores are excluded in code.
6. Data retention, regional processing, access controls, consent, deletion, and vendor terms have completed privacy review.
7. Any future check is isolated from Clarity and other categories so one speech span is not charged twice.

## Primary sources

- [Azure pronunciation assessment scenarios, result granularity, pricing, and preview notice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool)
- [Azure pronunciation assessment configuration and scripted or unscripted limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Azure pronunciation locales](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment)
- [Azure characteristics and limitations](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/pronunciation-assessment/characteristics-and-limitations-pronunciation-assessment)
- [Speechace scripted text pronunciation endpoint and unknown-word option](https://api-docs.speechace.com/api-reference/score-text-pronunciation)
- [Speechace phoneme, syllable, and stress fields](https://api-docs.speechace.com/api-reference/score-text-pronunciation/handling-phoneme-and-syllable-scores)
- [Deepgram word-confidence definition](https://developers.deepgram.com/docs/confidence)
