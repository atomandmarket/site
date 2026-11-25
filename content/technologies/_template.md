---
# Copy this file to a new name like 2026-12-09-short-technology-name.md
# The part after the date becomes the address: atomandmarket.com/technologies/short-technology-name/
# Files starting with "_template" are never published.

title: Name of the technology and what it does
date: 2026-12-09
sector: Batteries                 # free label, used for the archive filter
summary: One line shown in the lists on the homepage and archive.
who_should_care:
  - Cell makers
  - Grid storage integrators

source:
  authors: "Surname A., Surname B. et al."
  title: "Title of the paper"
  journal: "Journal name"         # leave out for preprints if you prefer
  year: 2026
  doi: "10.xxxx/xxxxx"            # or use url: https://... instead
  peer_reviewed: true             # false = shown as Preprint
  open_access: true

scorecard:                        # each score is a whole number from 1 to 5
  maturity:    { score: 3, why: "One line, specific to this technology." }
  scalability: { score: 3, why: "" }
  advantage:   { score: 3, why: "" }
  adoption:    { score: 3, why: "" }
  evidence:    { score: 3, why: "" }

verdict: promising                # scaling | promising | early | hype
horizon: 3–7 years                # not needed for hype

# Optional:
# score_override: { score: 7.0, why: "Why the score differs from the average." }
# disclosure: "Text shown under the source, e.g. a link with the author's work."
# corrections: "What was corrected and when."
# draft: true                     # alternative to keeping the file in content/drafts/
---

The comment, 500–700 words, in Markdown.

## The numbers that matter

| Metric | This technology | Benchmark today |
|---|---|---|
| Example | 410 mAh/g | ~300 mAh/g |

Optional sections with `##` headings.
