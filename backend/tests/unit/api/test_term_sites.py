from __future__ import annotations

import pytest

from bsllmner_viewer.api.term_sites import ontology_of, term_url


@pytest.mark.parametrize(
    ("term_id", "url"),
    [
        ("CVCL:0241", "https://www.cellosaurus.org/CVCL_0241"),
        ("NCBIGene:7157", "https://www.ncbi.nlm.nih.gov/gene/7157"),
        ("CL:0000236", "https://www.ebi.ac.uk/ols4/ontologies/cl/classes?obo_id=CL:0000236"),
        ("UBERON:0002371", "https://www.ebi.ac.uk/ols4/ontologies/uberon/classes?obo_id=UBERON:0002371"),
        ("MONDO:0007254", "https://www.ebi.ac.uk/ols4/ontologies/mondo/classes?obo_id=MONDO:0007254"),
        ("CHEBI:15422", "https://www.ebi.ac.uk/ols4/ontologies/chebi/classes?obo_id=CHEBI:15422"),
        ("EFO:0001187", "https://www.ebi.ac.uk/ols4/ontologies/efo/classes?obo_id=EFO:0001187"),
    ],
)
def test_term_url_of_a_listed_prefix_is_the_page_of_the_term(term_id: str, url: str) -> None:
    assert term_url(term_id) == url


@pytest.mark.parametrize("term_id", ["GO:0005575", "BFO:0000040", "26837", "", "CVCL:", ":0241"])
def test_term_url_of_an_unlisted_prefix_or_a_malformed_id_is_none(term_id: str) -> None:
    assert term_url(term_id) is None


@pytest.mark.parametrize("term_id", ["", "CVCL:", ":0241", "26837"])
def test_ontology_of_a_malformed_id_is_none(term_id: str) -> None:
    assert ontology_of(term_id) is None


def test_ontology_of_names_a_listed_prefix_and_keeps_an_unlisted_prefix_as_its_name() -> None:
    assert ontology_of("CVCL:0241") == ("CVCL", "Cellosaurus")
    assert ontology_of("NCBIGene:7157") == ("NCBIGene", "NCBI Gene")
    assert ontology_of("CHEBI:15422") == ("CHEBI", "ChEBI")
    assert ontology_of("CL:0000236") == ("CL", "Cell Ontology")
    assert ontology_of("GO:0005575") == ("GO", "GO")
    assert ontology_of("26837") is None
