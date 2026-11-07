"""Screenshot import: holdings screenshots → proposed snapshot rows.

A short chain, each step with one job:

1. reader     (vision model)  copies what each screenshot shows, verbatim
2. organiser  (model)         merges overlapping screenshots, picks which text
                              is quantity / price / value, maps names to symbols
3. verify     (code)          parses the numbers and checks the arithmetic
4. recheck    (vision model)  only when step 3 finds mismatches: re-reads the
                              exact cells in question; then step 3 runs again

The models never calculate; every number shown to the person comes from code.
Images live only in memory for the length of the request.
"""
