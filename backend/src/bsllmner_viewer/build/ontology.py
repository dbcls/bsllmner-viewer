"""Readers for ontology files: OBO and OWL (RDF/XML).

Both produce the same entries: term ID, label, synonyms, and parent term IDs. Term IDs are normalized
the way bsllmner-mk2 writes them (`MONDO:0007254`, `CVCL:0030`, `NCBIGene:7157`).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse

from lxml import etree

_RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
_RDFS = "http://www.w3.org/2000/01/rdf-schema#"
_OWL = "http://www.w3.org/2002/07/owl#"
_OBO_IN_OWL = "http://www.geneontology.org/formats/oboInOwl#"
_SKOS = "http://www.w3.org/2004/02/skos/core#"

_CLASS_TAG = f"{{{_OWL}}}Class"
_DESCRIPTION_TAG = f"{{{_RDF}}}Description"
_ABOUT = f"{{{_RDF}}}about"
_RESOURCE = f"{{{_RDF}}}resource"
_TYPE_TAG = f"{{{_RDF}}}type"
_LABEL_TAG = f"{{{_RDFS}}}label"
_PREF_LABEL_TAG = f"{{{_SKOS}}}prefLabel"
_SUBCLASS_TAG = f"{{{_RDFS}}}subClassOf"
_DEPRECATED_TAG = f"{{{_OWL}}}deprecated"
_SYNONYM_TAGS = frozenset(
    {
        f"{{{_OBO_IN_OWL}}}hasExactSynonym",
        f"{{{_OBO_IN_OWL}}}hasRelatedSynonym",
        f"{{{_OBO_IN_OWL}}}hasBroadSynonym",
        f"{{{_OBO_IN_OWL}}}hasNarrowSynonym",
        f"{{{_SKOS}}}altLabel",
        f"{{{_SKOS}}}hiddenLabel",
    }
)

_OBO_SYNONYM_RE = re.compile(r'^"((?:[^"\\]|\\.)*)"')


@dataclass(slots=True)
class OntologyTerm:
    term_id: str
    label: str | None
    synonyms: list[str] = field(default_factory=list)
    parents: list[str] = field(default_factory=list)


def normalize_term_id(value: str) -> str:
    """`http://purl.obolibrary.org/obo/CVCL_0384`, `Cellosaurus#CVCL_0384`, `CVCL_0384` -> `CVCL:0384`."""
    t = unicodedata.normalize("NFKC", value).strip()
    if not t:
        return t
    if "#" in t:
        t = t.split("#")[-1].strip()
    if "://" in t:
        p = urlparse(t)
        candidate = p.fragment or p.path.rstrip("/").split("/")[-1]
        t = unquote(candidate).strip() if candidate else t
    if ":" in t:
        prefix = t.split(":", 1)[0]
        if prefix and not prefix.lower().startswith("http"):
            return t
    if "_" in t:
        prefix, local = t.split("_", 1)
        if prefix and local:
            return f"{prefix}:{local}"
    return t


def read_ontology(path: Path) -> Iterator[OntologyTerm]:
    if path.suffix.lower() == ".obo":
        yield from read_obo(path)
    else:
        yield from read_owl(path)


def read_obo(path: Path) -> Iterator[OntologyTerm]:
    term: OntologyTerm | None = None
    obsolete = False
    in_term = False
    with path.open(encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if line.startswith("["):
                if term is not None and not obsolete:
                    yield term
                term = None
                obsolete = False
                in_term = line == "[Term]"
                continue
            if not in_term or not line or line.startswith("!"):
                continue
            key, _, value = line.partition(":")
            value = value.strip()
            if key == "id":
                term = OntologyTerm(term_id=normalize_term_id(value), label=None)
            elif term is None:
                continue
            elif key == "name":
                term.label = value
            elif key == "synonym":
                m = _OBO_SYNONYM_RE.match(value)
                if m:
                    term.synonyms.append(m.group(1).replace('\\"', '"'))
            elif key == "is_a":
                parent = value.split("!")[0].split("{")[0].strip()
                if parent:
                    term.parents.append(normalize_term_id(parent))
            elif key == "is_obsolete" and value.startswith("true"):
                obsolete = True
    if term is not None and not obsolete:
        yield term


def read_owl(path: Path) -> Iterator[OntologyTerm]:
    for _event, element in etree.iterparse(str(path), events=("end",), tag=(_CLASS_TAG, _DESCRIPTION_TAG)):
        about = element.get(_ABOUT)
        if about and (element.tag == _CLASS_TAG or _is_class_description(element)):
            term = _owl_term(about, element)
            if term is not None:
                yield term
        element.clear(keep_tail=False)
        parent = element.getparent()
        while parent is not None and parent.getprevious() is not None:
            del parent[0]


def _is_class_description(element: etree._Element) -> bool:
    return any(child.tag == _TYPE_TAG and child.get(_RESOURCE) == f"{_OWL}Class" for child in element)


def _owl_term(about: str, element: etree._Element) -> OntologyTerm | None:
    term = OntologyTerm(term_id=normalize_term_id(about), label=None)
    for child in element:
        tag = child.tag
        text = (child.text or "").strip()
        if tag == _DEPRECATED_TAG and text.lower() == "true":
            return None
        if tag == _LABEL_TAG:
            term.label = text or term.label
        elif tag == _PREF_LABEL_TAG and term.label is None:
            term.label = text or None
        elif tag in _SYNONYM_TAGS:
            if text:
                term.synonyms.append(text)
        elif tag == _SUBCLASS_TAG:
            resource = child.get(_RESOURCE)
            if resource:
                term.parents.append(normalize_term_id(resource))
    return term
