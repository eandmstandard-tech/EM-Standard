# Engineering Standard — Keyword / Index search test

This change targets the existing engineering-standard-hub Site first. It does not update GitHub, Vercel, Apps Script deployment, Drive sharing, or Cloud project resources.

## Supported searches

Use the default “ต้องพบทุกคำ” mode:

| Query | Meaning |
| --- | --- |
| `tank inspection` | Both terms must match the same catalog entry or Drive file. |
| `"pressure relief"` | Contiguous phrase. |
| `pump OR motor` | Either alternative. OR is uppercase. |
| `tank -LPG` | Exclude LPG from every alternative. |
| `"pressure relief" inspection -"hot work"` | Phrase and word, excluding a phrase. |
| `API 653`, `API653`, `API-653` | Recognize a standard reference, including API STD 653, in the catalog index. |

Maximum 120 characters and eight clauses. A quoted phrase counts as one clause. Parentheses, stemming, translation, fuzzy matching, and web search are not supported. “ข้อความตรงกันทั้งวลี” treats the entire input as a phrase; choose the default mode to use operators. “พบคำใดคำหนึ่ง” treats positive clauses as alternatives. Short and Thai substrings are supported in the browser index; Drive content search follows Drive fullText tokenization and indexing coverage.

## What is indexed

`dist/search-engine.js` builds reusable trigram postings for catalog metadata and pages already loaded from local PDF/DOCX selections. It verifies the original normalized text after candidate lookup, ranks exact standard references and title matches first, and applies discipline/publisher/scope filters. Separate page boundaries cannot create a false phrase. AND terms may occur on different pages of the same document; each relevant page is returned.

This browser index is held only in memory. It is invalidated on catalog replacement, changed metadata, added/removed files, or page-array changes. It is not a persistent shared content index of every Drive document. Imported bytes and extracted local text are not sent to the server by this feature and disappear when the page is reloaded.

`dist/drive-search.js` reuses the existing Apps Script `search` and `pages` endpoints. A simple search still uses one search request. Advanced searches are compiled into the existing `all` / `any` / `phrase` requests, evaluated by Drive file ID, and combined by intersection, union, and subtraction. No new OAuth Client ID, Cloud service, or paid extraction job is required by this change.

Advanced requests run with at most two network requests in flight. Successful responses are cached in session memory for two minutes, up to 24 entries; errors are not cached. Refresh clears the cache when a new index payload is accepted. Superseded query responses cannot replace the current results.

Apps Script currently caps returned files at 12 per standard and paginates at most ten Drive response pages. Positive truncated results are labelled partial. If an exclusion response is incomplete, the advanced remote search reports an error rather than admitting potentially excluded files. Local metadata results remain available and are labelled separately. This feature does not change the backend cap.

Drive results provide file metadata. Page numbers/excerpts appear only when the existing authorized page-index service supplies them, or after a file is selected locally. This frontend update does not build a complete server-side PDF/Word page index, perform OCR, or bypass access rules. DOCX page numbers require Word's saved rendered page breaks. Preview page anchors depend on the Drive viewer and are not a guaranteed jump-to-page API.

## Manual browser checks

1. Open the Site and confirm that the existing catalog loads. Check the new keyword-index status: catalog record count is distinct from locally indexed page count.
2. Choose “รหัสและชื่อมาตรฐาน”, enter `API 653`, and confirm that the concise API STD 653 entry ranks before language/edition variants. This mode does not send content-search requests.
3. Try `"pressure relief"`, `pump OR motor`, and `tank -LPG` in the default scope. Wait for the Drive search status before judging remote matches. Confirm excerpts/page notes remain honest when the page index is unavailable.
4. Enter an unfinished quote or `pump OR`; confirm a useful validation message and no remote search for malformed input.
5. Choose a test PDF containing “storage” on page 1 and “inspection” on page 2. Search `storage inspection` in content scope; both pages must appear. A phrase spanning two different pages must not match.
6. Select a DOCX with and without saved page breaks. Confirm known page numbers are preserved and missing page numbers are never fabricated.
7. Type another query while Drive is loading, change scope, and clear the selection. Confirm old results do not replace the latest query.
8. Test narrow screens and keyboard operation. Native title suggestions offer up to eight catalog entries.

## Automated validation

Run `node --test tests/*.test.cjs` and `node --check` for changed JavaScript files. Tests cover real parsing/index lookup, differential comparisons against direct text matching, standard-reference ranking, file-level set algebra, truncated exclusions, transport failures, deferred pages, concurrency, cache invalidation, cancellation, and the existing refresh protocol.

## Verified in browser, 2026-11-02

- Existing Apps Script loaded 320 catalog entries.
- Title query `API 653` ranked `API STD 653` first.
- Live Drive query `pump OR motor` completed with 181 matching folders; `tank -LPG` completed with 158 matching folders in that session. Counts are observations, not fixed expected values.
- Backend reported page-index access restricted; automatic Drive page numbers could not be verified and were not enabled or bypassed.
- A synthetic three-page PDF and two-page DOCX were selected locally. `storage inspection` matched the PDF and displayed pages 1 and 2. `"pressure relief" -LPG` excluded the PDF containing LPG and displayed the DOCX hit on page 2.
- An unclosed quote produced inline validation. No application console errors were observed; browser extension diagnostics were excluded from application findings.
- All 62 automated tests passed.
