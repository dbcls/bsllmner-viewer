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
        'is_a: MONDO:0000002 {source="x"} ! other\nrelationship: develops_from MONDO:9 ! ignored\n\n'
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


_OBO_HEAD = "format-version: 1.2\n\n[Term]\nid: X:1\nname: a\n"


def _obo_parents(tmp_path: Path, body: str) -> list[str]:
    path = tmp_path / "x.obo"
    path.write_text(_OBO_HEAD + body + "\n[Typedef]\nid: part_of\n")
    return next(t for t in read_obo(path) if t.term_id == "X:1").parents


def test_read_obo_part_of_relationships_with_comments_and_qualifiers_are_parents(tmp_path: Path) -> None:
    parents = _obo_parents(
        tmp_path,
        "is_a: X:2 ! two\n"
        "relationship: part_of X:3 ! three\n"
        'relationship: part_of X:4 {source="FMA", source="ZFA-def"} ! four\n'
        "relationship: BFO:0000050 X:5\n"
        'relationship: BFO:0000050 X:6 {source="x"}\n',
    )
    assert parents == ["X:2", "X:3", "X:4", "X:5", "X:6"]


def test_read_obo_part_of_with_all_only_qualifier_is_not_a_parent(tmp_path: Path) -> None:
    parents = _obo_parents(
        tmp_path,
        'relationship: BFO:0000050 X:2 {all_only="true"} ! part of continuant\n'
        'relationship: part_of X:3 {source="x", all_only="true"}\n'
        'relationship: part_of X:4 {all_only="false"}\n',
    )
    assert parents == ["X:4"]


def test_read_obo_other_relationships_are_not_parents(tmp_path: Path) -> None:
    parents = _obo_parents(
        tmp_path,
        "relationship: develops_from X:2\n"
        "relationship: RO:0002202 X:3\n"
        "relationship: has_part X:4\n"
        "relationship: part_of_x X:5\n"
        "relationship: part_of\n"
        "relationship:\n",
    )
    assert parents == []


def _owl(body: str) -> str:
    return (
        '<?xml version="1.0"?>\n'
        '<rdf:RDF xmlns="http://www.w3.org/2002/07/owl#" xmlns:owl="http://www.w3.org/2002/07/owl#"\n'
        ' xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">\n'
        f'<Class rdf:about="http://purl.obolibrary.org/obo/UBERON_1">{body}</Class>\n'
        "</rdf:RDF>\n"
    )


def _restriction(prop: str, value: str, kind: str = "someValuesFrom") -> str:
    return (
        "<rdfs:subClassOf><owl:Restriction>"
        f'<owl:onProperty rdf:resource="{prop}"/><owl:{kind} rdf:resource="{value}"/>'
        "</owl:Restriction></rdfs:subClassOf>"
    )


_BFO_PART_OF = "http://purl.obolibrary.org/obo/BFO_0000050"


def test_read_owl_part_of_restriction_is_a_parent(tmp_path: Path) -> None:
    path = tmp_path / "x.owl"
    path.write_text(
        _owl(
            '<rdfs:subClassOf rdf:resource="http://purl.obolibrary.org/obo/UBERON_2"/>'
            + _restriction(_BFO_PART_OF, "http://purl.obolibrary.org/obo/UBERON_3")
            + _restriction(_BFO_PART_OF, "http://purl.obolibrary.org/obo/UBERON_4")
        )
    )
    (term,) = read_owl(path)
    assert term.parents == ["UBERON:2", "UBERON:3", "UBERON:4"]


def test_read_owl_other_restrictions_are_not_parents(tmp_path: Path) -> None:
    path = tmp_path / "x.owl"
    path.write_text(
        _owl(
            _restriction("http://purl.obolibrary.org/obo/RO_0002202", "http://purl.obolibrary.org/obo/UBERON_2")
            + _restriction(_BFO_PART_OF, "http://purl.obolibrary.org/obo/UBERON_3", kind="allValuesFrom")
            + "<rdfs:subClassOf><owl:Restriction>"
            f'<owl:onProperty rdf:resource="{_BFO_PART_OF}"/>'
            "<owl:someValuesFrom><owl:Class/></owl:someValuesFrom></owl:Restriction></rdfs:subClassOf>"
            "<rdfs:subClassOf><owl:Restriction/></rdfs:subClassOf>"
        )
    )
    (term,) = read_owl(path)
    assert term.parents == []


def test_read_owl_nested_class_expression_does_not_hide_following_classes(tmp_path: Path) -> None:
    path = tmp_path / "x.owl"
    class_a = (
        '<Class rdf:about="http://purl.obolibrary.org/obo/UBERON_%d">'
        "<rdfs:subClassOf><owl:Restriction>"
        f'<owl:onProperty rdf:resource="{_BFO_PART_OF}"/>'
        '<owl:someValuesFrom><owl:Class><owl:unionOf rdf:parseType="Collection"/></owl:Class></owl:someValuesFrom>'
        "</owl:Restriction></rdfs:subClassOf>"
        "<rdfs:subClassOf><owl:Restriction>"
        f'<owl:onProperty rdf:resource="{_BFO_PART_OF}"/>'
        '<owl:someValuesFrom rdf:resource="http://purl.obolibrary.org/obo/UBERON_9"/>'
        "</owl:Restriction></rdfs:subClassOf></Class>\n"
    )
    path.write_text(_owl("").split("<Class")[0] + "".join(class_a % i for i in range(1, 4)) + "</rdf:RDF>\n")
    terms = list(read_owl(path))
    assert [t.term_id for t in terms] == ["UBERON:1", "UBERON:2", "UBERON:3"]
    assert all(t.parents == ["UBERON:9"] for t in terms)


def test_read_obo_general_class_inclusion_axioms_are_not_parents(tmp_path: Path) -> None:
    parents = _obo_parents(
        tmp_path,
        'relationship: BFO:0000050 X:2 {gci_relation="RO:0002216", gci_filler="GO:0019233"} ! part of x\n'
        'relationship: part_of X:3 {gci_filler="GO:1"}\n'
        'relationship: part_of X:4 {gci_relation="RO:1"}\n'
        'is_a: X:5 {gci_filler="UBERON:0000945", gci_relation="BFO:0000050"}\n'
        'is_a: X:6 {gci_relation="BFO:0000050"} ! six\n'
        'is_a: X:7 {source="x"}\n'
        'relationship: part_of X:8 {source="gci_relation"}\n',
    )
    assert parents == ["X:7", "X:8"]


def test_read_obo_part_of_to_another_prefix_is_not_a_parent_but_is_a_is(tmp_path: Path) -> None:
    parents = _obo_parents(
        tmp_path,
        "is_a: Y:2\n"
        "relationship: part_of Y:3\n"
        "relationship: BFO:0000050 Y:4 ! four\n"
        "relationship: part_of X:5\n"
        "relationship: part_of http://purl.obolibrary.org/obo/Y_6\n"
        "relationship: part_of 12345\n",
    )
    assert parents == ["Y:2", "X:5"]


def test_read_owl_part_of_to_another_prefix_is_not_a_parent_but_subclass_is(tmp_path: Path) -> None:
    path = tmp_path / "x.owl"
    path.write_text(
        _owl(
            '<rdfs:subClassOf rdf:resource="http://purl.obolibrary.org/obo/CL_2"/>'
            + _restriction(_BFO_PART_OF, "http://purl.obolibrary.org/obo/CL_3")
            + _restriction(_BFO_PART_OF, "http://purl.obolibrary.org/obo/UBERON_4")
        )
    )
    (term,) = read_owl(path)
    assert term.parents == ["CL:2", "UBERON:4"]


def test_read_owl_anonymous_top_level_class_is_skipped(tmp_path: Path) -> None:
    path = tmp_path / "x.owl"
    gci = '<Class><intersectionOf/><rdfs:subClassOf rdf:resource="http://purl.obolibrary.org/obo/UBERON_9"/></Class>\n'
    path.write_text(_owl("").replace("</rdf:RDF>", gci + "</rdf:RDF>"))
    assert [t.term_id for t in read_owl(path)] == ["UBERON:1"]
