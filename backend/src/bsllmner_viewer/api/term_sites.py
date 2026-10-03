"""The ontology that the prefix of a term ID names, and the page of the term on the site of that ontology."""

from __future__ import annotations

_OLS = "https://www.ebi.ac.uk/ols4/ontologies/{ontology}/classes?obo_id={term_id}"

# Prefix: (the name of the ontology, the address of a term's page). `{local}` is the part of the ID after the prefix,
# `{term_id}` the whole ID, and `{ontology}` the prefix in lower case, as the EBI Ontology Lookup Service names it.
_SITES: dict[str, tuple[str, str]] = {
    "CVCL": ("Cellosaurus", "https://www.cellosaurus.org/CVCL_{local}"),
    "NCBIGene": ("NCBI Gene", "https://www.ncbi.nlm.nih.gov/gene/{local}"),
    "CL": ("Cell Ontology", _OLS),
    "UBERON": ("UBERON", _OLS),
    "MONDO": ("MONDO", _OLS),
    "CHEBI": ("ChEBI", _OLS),
    "EFO": ("EFO", _OLS),
}


def _split(term_id: str) -> tuple[str, str] | None:
    prefix, colon, local = term_id.partition(":")
    return (prefix, local) if colon and prefix and local else None


def ontology_name(prefix: str) -> str:
    """The name of the ontology that a prefix names; an unlisted prefix is its own name."""
    return _SITES[prefix][0] if prefix in _SITES else prefix


def ontology_of(term_id: str) -> tuple[str, str] | None:
    """The prefix of the term ID and the name of the ontology that it names."""
    parts = _split(term_id)
    return None if parts is None else (parts[0], ontology_name(parts[0]))


def term_url(term_id: str) -> str | None:
    """The page of the term on the site of its ontology, or None for a prefix that the table does not list."""
    parts = _split(term_id)
    if parts is None or parts[0] not in _SITES:
        return None
    prefix, local = parts
    return _SITES[prefix][1].format(local=local, term_id=term_id, ontology=prefix.lower())


def shown_synonyms(label: str | None, synonyms: list[str]) -> list[str]:
    """The synonyms that say more than the label: none that differs from the label or from another only in case."""
    seen = {label.casefold()} if label else set()
    shown: list[str] = []
    for synonym in synonyms:
        key = synonym.casefold()
        if key not in seen:
            seen.add(key)
            shown.append(synonym)
    return shown
