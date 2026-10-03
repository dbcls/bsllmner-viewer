"""The name of each organism, as build and api choose it."""

from __future__ import annotations

# One name per NCBI Taxonomy ID: the name that most BioSamples of the store give, and of equally common names the
# first in order. Input entries do not always agree, for example `9606` or `Human` for `Homo sapiens`.
ORGANISM_NAMES = """
SELECT organism_id, organism_name FROM (
    SELECT organism_id, organism_name,
           row_number() OVER (PARTITION BY organism_id ORDER BY count(*) DESC, organism_name) AS place
    FROM biosample
    WHERE organism_id IS NOT NULL AND organism_name IS NOT NULL
    GROUP BY organism_id, organism_name
) WHERE place = 1
"""
