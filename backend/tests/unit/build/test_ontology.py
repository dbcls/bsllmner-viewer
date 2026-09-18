from __future__ import annotations

from pathlib import Path

import pytest

from bsllmner_viewer.build.ontology import normalize_term_id, read_obo, read_owl


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("CVCL_0384", "CVCL:0384"),
        ("CVCL:0384", "CVCL:0384"),
        ("http://purl.obolibrary.org/obo/Cellosaurus#CVCL_R965", "CVCL:R965"),
        ("http://purl.obolibrary.org/obo/MONDO_0007254", "MONDO:0007254"),
        ("http://purl.obolibrary.org/obo/NCBIGene_6427", "NCBIGene:6427"),
        ("  MONDO:0000001 ", "MONDO:0000001"),
        ("plain", "plain"),
    ],
)
def test_normalize_term_id(value: str, expected: str) -> None:
    assert normalize_term_id(value) == expected


def test_read_obo_reads_terms_synonyms_parents_and_skips_obsolete(tmp_path: Path) -> None:
    path = tmp_path / "x.obo"
    path.write_text(
        "format-version: 1.2\n\n[Term]\nid: MONDO:0000001\nname: disease\n\n"
        '[Term]\nid: MONDO:0004992\nname: cancer\nsynonym: "malignant neoplasm" EXACT []\n'
        'synonym: "say \\"hi\\"" RELATED []\nis_a: MONDO:0000001 ! disease\n'
        'is_a: MONDO:0000002 {source="x"} ! other\nrelationship: part_of MONDO:9 ! ignored\n\n'
        "[Term]\nid: MONDO:0000003\nname: gone\nis_obsolete: true\n\n[Typedef]\nid: part_of\n"
    )
    terms = {t.term_id: t for t in read_obo(path)}
    assert set(terms) == {"MONDO:0000001", "MONDO:0004992"}
    cancer = terms["MONDO:0004992"]
    assert cancer.label == "cancer"
    assert cancer.synonyms == ["malignant neoplasm", 'say "hi"']
    assert cancer.parents == ["MONDO:0000001", "MONDO:0000002"]


def test_read_owl_reads_classes_descriptions_and_direct_subclass_resources(tmp_path: Path) -> None:
    path = tmp_path / "x.owl"
    path.write_text(
        '<?xml version="1.0"?>\n'
        '<rdf:RDF xmlns="http://www.w3.org/2002/07/owl#" xmlns:owl="http://www.w3.org/2002/07/owl#"\n'
        ' xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"\n'
        ' xmlns:oboInOwl="http://www.geneontology.org/formats/oboInOwl#">\n'
        '<Class rdf:about="http://purl.obolibrary.org/obo/MONDO_0007254">\n'
        "  <rdfs:label>breast cancer</rdfs:label>\n"
        "  <oboInOwl:hasExactSynonym>mammary cancer</oboInOwl:hasExactSynonym>\n"
        '  <rdfs:subClassOf rdf:resource="http://purl.obolibrary.org/obo/MONDO_0004992"/>\n'
        "  <rdfs:subClassOf><owl:Restriction/></rdfs:subClassOf>\n"
        "</Class>\n"
        '<rdf:Description rdf:about="http://purl.obolibrary.org/obo/NCBIGene_6427">\n'
        '  <rdf:type rdf:resource="http://www.w3.org/2002/07/owl#Class"/>\n'
        "  <rdfs:label>SRSF2</rdfs:label>\n"
        "</rdf:Description>\n"
        '<owl:Class rdf:about="http://purl.obolibrary.org/obo/MONDO_0000009">\n'
        "  <rdfs:label>old</rdfs:label><owl:deprecated>true</owl:deprecated>\n"
        "</owl:Class>\n"
        '<rdf:Description rdf:about="http://example.org/not-a-class"><rdfs:label>x</rdfs:label></rdf:Description>\n'
        "</rdf:RDF>\n"
    )
    terms = {t.term_id: t for t in read_owl(path)}
    assert set(terms) == {"MONDO:0007254", "NCBIGene:6427"}
    assert terms["MONDO:0007254"].label == "breast cancer"
    assert terms["MONDO:0007254"].synonyms == ["mammary cancer"]
    assert terms["MONDO:0007254"].parents == ["MONDO:0004992"]
