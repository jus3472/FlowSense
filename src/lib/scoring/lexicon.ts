/**
 * Word lists the rules depend on. Kept in one place because several detectors
 * consult the same sets and a word drifting between them changes scores.
 */

/** Pause classification: a pause after one of these is mid-sentence. */
export const FUNCTION_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'and',
  'but',
  'or',
  'so',
  'that',
  'which',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'i',
  'we',
  'they',
  'it',
  'this',
  'my',
  'our',
  'because',
  'if',
  'when',
  'as',
  'at',
  'from',
  'yeah',
  'okay',
  'well',
  'right',
])

export const PERSONAL_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'we', 'they', 'it'])

export const AUXILIARIES = new Set([
  'would',
  'will',
  'could',
  'should',
  'shall',
  'can',
  'may',
  'might',
  'must',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  "don't",
  "doesn't",
  "didn't",
  "wouldn't",
  "couldn't",
  "shouldn't",
  "won't",
  "can't",
  'not',
  'never',
])

export const BE_FORMS = new Set([
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  "'s",
  "'re",
])

/** Words that make a following `like` a comparison rather than a filler. */
export const LIKE_BLOCKERS = new Set([
  'sounds',
  'looks',
  'feels',
  'seems',
  'sound',
  'look',
  'feel',
  'seem',
  'something',
  'anything',
  'nothing',
  'everything',
  'stuff',
  'things',
  'thing',
  'just',
])

export const DETERMINERS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'some',
  'any',
  'my',
  'our',
  'your',
  'his',
  'her',
  'their',
  'its',
])

export const QUANTIFIERS = new Set([
  'a',
  'an',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'hundred',
  'thousand',
  'million',
  'many',
  'few',
  'several',
  'couple',
  'dozen',
  'half',
])

/** Connectives that repeat legitimately and must never read as a restart. */
export const CONNECTIVES = new Set([
  'as',
  'well',
  'and',
  'then',
  'or',
  'also',
  'plus',
  'too',
  'so',
  'but',
])

/** Tokens that may sit between two occurrences of a word without breaking a restart. */
export const RESTART_CONNECTORS = new Set(['or', 'sorry', 'no', 'rather'])

/**
 * Openers of a genuine self correction. Never scored: abandoning a bad
 * formulation is what a competent speaker does, and charging for it teaches
 * people to commit to the worse first attempt.
 */
export const BACKTRACK_PHRASES: readonly string[][] = [
  ['wait'],
  ['oh', 'wait'],
  ['what', 'i', 'meant'],
  ['what', 'i', 'meant', 'was'],
  ['let', 'me', 'back', 'up'],
  ['or', 'rather'],
  ['sorry'],
  ['no'],
  ['actually'],
  ['i', 'mean'],
]

/** Very common verbs, used where a full part of speech tagger would be overkill. */
export const COMMON_VERBS = new Set([
  'like',
  'likes',
  'liked',
  'want',
  'wants',
  'wanted',
  'need',
  'needs',
  'needed',
  'think',
  'thinks',
  'thought',
  'know',
  'knows',
  'knew',
  'go',
  'goes',
  'went',
  'get',
  'gets',
  'got',
  'make',
  'makes',
  'made',
  'take',
  'takes',
  'took',
  'see',
  'sees',
  'saw',
  'come',
  'comes',
  'came',
  'give',
  'gives',
  'gave',
  'find',
  'finds',
  'found',
  'work',
  'works',
  'worked',
  'play',
  'plays',
  'played',
  'use',
  'uses',
  'used',
  'solve',
  'solving',
  'solves',
  'help',
  'helps',
  'helped',
  'love',
  'loves',
  'loved',
  'enjoy',
  'enjoys',
  'enjoyed',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'say',
  'says',
  'said',
  'feel',
  'feels',
  'felt',
])

export function looksLikeVerb(word: string): boolean {
  if (COMMON_VERBS.has(word)) return true
  return /(ing|ed)$/.test(word) && word.length > 4
}

export function isFunctionWord(word: string): boolean {
  return FUNCTION_WORDS.has(word) || DETERMINERS.has(word) || CONNECTIVES.has(word)
}

export const PREPOSITIONS = new Set([
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'from',
  'by',
  'about',
  'into',
  'over',
  'after',
  'before',
  'under',
  'between',
  'through',
  'during',
  'without',
  'like',
  'than',
])

/**
 * Adjectives carrying no information. A phrase built only from these is not
 * something a listener would notice repeating.
 */
export const GENERIC_ADJECTIVES = new Set([
  'pretty',
  'different',
  'good',
  'nice',
  'very',
  'really',
  'great',
  'big',
  'small',
  'cool',
  'fun',
  'interesting',
  'important',
  'same',
  'other',
  'certain',
  'such',
  'whole',
  'real',
  'main',
  'lot',
  'bit',
  'kind',
  'sort',
])

/** A phrase may not open on one of these: it would be a fragment. */
export const BANNED_PHRASE_START = new Set([
  ...PERSONAL_PRONOUNS,
  ...PREPOSITIONS,
  ...AUXILIARIES,
  ...BE_FORMS,
  'and',
  'but',
  'or',
  'so',
  'that',
  'which',
  'because',
  'if',
  'when',
  'as',
  'then',
])

/** A phrase may not close on one of these, determiners included. */
export const BANNED_PHRASE_END = new Set([...BANNED_PHRASE_START, ...DETERMINERS])

/** Counted under filler words, so never a phrase worth reporting as repeated. */
export const FILLER_SURFACE_WORDS = new Set([
  'um',
  'uh',
  'er',
  'erm',
  'umm',
  'mhmm',
  'yeah',
  'yep',
  'okay',
  'ok',
  'hmm',
  'huh',
  'basically',
  'literally',
  'honestly',
  'anyway',
])

/** Carries meaning: roughly a noun or a verb, without a full tagger. */
export function isContentBearing(word: string): boolean {
  if (FILLER_SURFACE_WORDS.has(word)) return false
  if (looksLikeVerb(word)) return true
  if (FUNCTION_WORDS.has(word)) return false
  if (DETERMINERS.has(word)) return false
  if (CONNECTIVES.has(word)) return false
  if (PREPOSITIONS.has(word)) return false
  if (PERSONAL_PRONOUNS.has(word)) return false
  if (AUXILIARIES.has(word)) return false
  if (BE_FORMS.has(word)) return false
  if (GENERIC_ADJECTIVES.has(word)) return false
  if (/ly$/.test(word)) return false
  return word.length > 1
}
