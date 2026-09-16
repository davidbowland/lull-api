/*
 * British spellings of words this game ships in their American form.
 *
 * WHY THIS IS A GATE AND NOT A PROMPT SENTENCE. Every generation prompt already carries an AMERICAN
 * SPELLING rule -- create-anagram-sets.txt, create-cryptic-clues.txt and create-phrases.txt each
 * state it, and two review prompts re-check it. Nothing in code verified any of it, and the lexicon
 * that decides whether a model's word is a word is ENABLE, which carries the British forms as
 * ordinary entries. Measured against the committed index, nineteen of them clear the themed-anagram
 * lexicon outright:
 *
 *   COLOUR COLOURS HONOUR DEFENCE ORGANISE REALISE ANALYSE FLAVOUR LABOUR ARMOUR HARBOUR MOUSTACHE
 *   MOTORWAY LADYBIRD JEWELLERY PYJAMAS SPLENDOUR BEHAVIOUR NEIGHBOUR
 *
 * So the rule's whole enforcement was the model choosing to follow it. On the surfaces gated here
 * that is not a style slip: the player TYPES these. A board showing a scramble of COLOUR is one the
 * player answers COLOR to and is marked wrong, with no way to discover why -- which is exactly the
 * outcome create-anagram-sets.txt names when it says "a British spelling is an answer they cannot
 * enter". This is the length-bound-and-content-check half of validating what the model hands back.
 *
 * WHOLE-TOKEN, NEVER SUBSTRING, for the reason charged-terms.ts is whole-token: GREYHOUND is a
 * correct English word containing GREY, and a substring rule fails it. No entry here is ever
 * checked as a fragment of a longer word, and that is what makes an enumerated list the only safe
 * shape -- every inflection that should be caught has to be written out.
 *
 * ONLY UNAMBIGUOUS FORMS. An entry earns its place by being wrong in American English, not by being
 * more common in Britain. DELIBERATELY ABSENT, so nobody re-derives the omission later:
 *
 *   AXE, DOUGHNUT, GREYHOUND, CATALOGUE, DIALOGUE, MONOLOGUE, WHISKY, OMELETTE, SABRE, ADVISE,
 *   EXERCISE, SURPRISE, FRANCHISE, COMPROMISE, MERCHANDISE, TELEVISE, SUPERVISE, ENTERPRISE
 *
 * Every one of those is either standard American (AXE, DOUGHNUT, SABRE in fencing, the -ISE verbs
 * that were never -IZE) or a spelling American usage accepts alongside the shorter one (CATALOGUE,
 * DIALOGUE). A gate that rejected ADVISE because it ends in -ISE would reject correct English on
 * every phrase that used it, and those verbs are precisely why this is an enumerated list rather
 * than a suffix rule.
 *
 * THREE NEAR-MISSES ARE WORTH NAMING, because each looks like it belongs and does not. ANALYSES is
 * the ordinary American plural of ANALYSIS, not an inflection of ANALYSE. THEATRICAL is spelled the
 * same in both dialects, so listing it beside THEATRE would reject correct English. HUMOUROUS is a
 * misspelling everywhere -- British is HUMOUR but HUMOROUS -- and a gate is not the place to catch
 * it. THEATRE itself is the closest call that IS listed: American proper names keep the spelling
 * (Ford's Theatre), but no gate here reads a proper name -- Themed Anagrams rejects them at the
 * charset gate, and a phrase that needs it can be redrawn.
 *
 * Entries are single uppercase A-Z tokens. The tokenizer in model-output-checks.ts splits on
 * letter-and-digit runs, so a space or a hyphen in an entry makes it permanently unmatchable.
 */
export const britishSpellings: ReadonlySet<string> = new Set([
  // -OUR for -OR, and the inflections, because matching has no stemming.
  'ARMOUR',
  'ARMOURED',
  'ARMOURS',
  'BEHAVIOUR',
  'BEHAVIOURAL',
  'BEHAVIOURS',
  'CANDOUR',
  'CLAMOUR',
  'CLAMOURED',
  'CLAMOURS',
  'COLOUR',
  'COLOURED',
  'COLOURFUL',
  'COLOURING',
  'COLOURLESS',
  'COLOURS',
  'DEMEANOUR',
  'ENDEAVOUR',
  'ENDEAVOURS',
  'FAVOUR',
  'FAVOURABLE',
  'FAVOURED',
  'FAVOURITE',
  'FAVOURITES',
  'FAVOURS',
  'FERVOUR',
  'FLAVOUR',
  'FLAVOURED',
  'FLAVOURS',
  'HARBOUR',
  'HARBOURS',
  'HONOUR',
  'HONOURABLE',
  'HONOURED',
  'HONOURS',
  'HUMOUR',
  'HUMOURS',
  'LABOUR',
  'LABOURED',
  'LABOURER',
  'LABOURERS',
  'LABOURS',
  'NEIGHBOUR',
  'NEIGHBOURHOOD',
  'NEIGHBOURING',
  'NEIGHBOURS',
  'ODOUR',
  'ODOURS',
  'PARLOUR',
  'PARLOURS',
  'RANCOUR',
  'RUMOUR',
  'RUMOURS',
  'SAVIOUR',
  'SAVIOURS',
  'SAVOUR',
  'SAVOURED',
  'SAVOURS',
  'SPLENDOUR',
  'TUMOUR',
  'TUMOURS',
  'VALOUR',
  'VAPOUR',
  'VAPOURS',
  'VIGOUR',

  // -RE for -ER. CENTRE and METRE carry the compounds because the bare token is what gets matched.
  'CALIBRE',
  'CENTRE',
  'CENTRED',
  'CENTRES',
  'FIBRE',
  'FIBRES',
  'LITRE',
  'LITRES',
  'LUSTRE',
  'MANOEUVRE',
  'MANOEUVRES',
  'METRE',
  'METRES',
  'SCEPTRE',
  'SOMBRE',
  'SPECTRE',
  'SPECTRES',
  'THEATRE',
  'THEATRES',

  // -CE for -SE. PRACTISE is the verb only; PRACTICE is correct in both dialects as the noun and is
  // deliberately absent.
  'DEFENCE',
  'DEFENCES',
  'LICENCE',
  'LICENCES',
  'OFFENCE',
  'OFFENCES',
  'PRACTISE',
  'PRACTISED',
  'PRACTISES',
  'PRETENCE',

  // -ISE/-YSE for -IZE/-YZE. Only verbs that are -IZE in American English -- see the absent list in
  // the header for the ones that are -ISE in both.
  'AGONISE',
  'ANALYSE',
  'ANALYSED',
  'APOLOGISE',
  'APOLOGISED',
  'CATEGORISE',
  'CIVILISE',
  'CRITICISE',
  'CRITICISED',
  'CUSTOMISE',
  'EMPHASISE',
  'EMPHASISED',
  'MEMORISE',
  'MINIMISE',
  'MOBILISE',
  'NORMALISE',
  'ORGANISE',
  'ORGANISED',
  'ORGANISES',
  'PARALYSE',
  'PARALYSED',
  'PRIORITISE',
  'RANDOMISE',
  'REALISE',
  'REALISED',
  'REALISES',
  'RECOGNISE',
  'RECOGNISED',
  'RECOGNISES',
  'SPECIALISE',
  'STANDARDISE',
  'SUMMARISE',
  'SYMPATHISE',
  'UTILISE',

  // Doubled L before a suffix.
  'CANCELLED',
  'CANCELLING',
  'COUNSELLOR',
  'COUNSELLORS',
  'FUELLED',
  'JEWELLERY',
  'LABELLED',
  'LABELLING',
  'MARVELLOUS',
  'MODELLING',
  'SIGNALLED',
  'TRAVELLED',
  'TRAVELLER',
  'TRAVELLERS',
  'TRAVELLING',
  'WOOLLEN',

  // Everything else, spelling and vocabulary together: a word that is simply not the American one.
  'ALUMINIUM',
  'AEROPLANE',
  'ANTICLOCKWISE',
  'CHEQUE',
  'CHEQUES',
  'DRAUGHT',
  'DRAUGHTS',
  'DUSTBIN',
  'DUSTBINS',
  'GAOL',
  'GREY',
  'KERB',
  'KERBS',
  'LADYBIRD',
  'LADYBIRDS',
  'MOULD',
  'MOULDS',
  'MOULDY',
  'MOUSTACHE',
  'MOUSTACHES',
  'MOTORWAY',
  'MOTORWAYS',
  'PLOUGH',
  'PLOUGHED',
  'PLOUGHS',
  'PYJAMAS',
  'SCEPTIC',
  'SCEPTICAL',
  'SMOULDER',
  'SMOULDERING',
  'STOREY',
  'STOREYS',
  'TYRE',
  'TYRES',
  'WINDSCREEN',
  'WINDSCREENS',
])
