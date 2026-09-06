# Build-time data

Corpora read by the `scripts/build-*` derivations. **Never bundled into a Lambda** and not runtime
dependencies — nothing under `src/` imports this directory. They live here so every derived asset is
reproducible from a pinned input rather than from whatever was on a laptop the day it was written.

| File                              | Read by                                                                                           | Pinned by         | License                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------ |
| `concreteness-brysbaert-2014.txt` | `scripts/build-word-lists.ts`                                                                     | hash in that file | `src/assets/LICENSE-brysbaert` |
| `enable.txt`                      | `scripts/build-anagram-index.ts`, `scripts/build-cryptic-words.ts`, `scripts/build-dictionary.ts` | `enable.sha256`   | `LICENSE-enable`               |

## concreteness-brysbaert-2014.txt

Input to `scripts/build-word-lists.ts`, which generates `src/assets/{nouns,verbs,adjectives}.ts`.

    Brysbaert, M., Warriner, A.B., & Kuperman, V. (2014). Concreteness ratings for 40 thousand
    generally known English word lemmas. Behavior Research Methods, 46, 904-911.
    https://doi.org/10.3758/s13428-013-0403-5

Used and modified under CC BY 4.0. The generated asset files carry the same citation in a header
comment; the license text lives at `src/assets/LICENSE-brysbaert`, beside the files that ship.

### Provenance

Downloaded from:

    https://raw.githubusercontent.com/ArtsEngine/concreteness/master/Concreteness_ratings_Brysbaert_et_al_BRM.txt

That is a mirror, not the authors' own distribution, which is why the hash below matters.

Source line endings are CRLF and were normalized to LF on download:

    tr -d '\r' < downloaded.txt > concreteness-brysbaert-2014.txt

The normalization is not cosmetic. A trailing `\r` rides on the last tab-delimited column, so every
`Dom_Pos` comparison fails silently and all three lists come out empty rather than erroring.

### Integrity

    sha256  08196a05dcaa774d49eaaf0fdf8617d4ed6cf26d2d95d92a1da9afbcecfbdf10
    lines   39,955 (including the header)

`build-word-lists.ts` verifies this hash before parsing and throws on a mismatch. Verify by hand:

    shasum -a 256 scripts/data/concreteness-brysbaert-2014.txt

**What the hash does and does not prove.** It pins what was vendored, so a later swap or truncation
fails loudly. It says nothing about whether the mirror matched the authors' own distribution at
download time — it was computed from the mirror, so an alteration made before the fetch would be
blessed permanently.

The corroborating evidence, which is checkable against the published paper rather than against this
repo:

- 37,058 single words and 2,896 two-word expressions, matching the counts in Brysbaert et al. (2014)
- all 39,954 data rows have exactly 9 tab-separated fields
- `Bigram` is always 0 or 1, and `Conc.M` is numeric in every row

Worth cross-checking once against the authors' distribution (crr.ugent.be, or the Springer
supplementary material) and recording the result here.
