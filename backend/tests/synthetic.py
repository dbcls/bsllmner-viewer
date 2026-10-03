"""Synthetic datasets in the build's input formats, for tests and fixtures."""

from __future__ import annotations

import datetime
import json
import random
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

FIELDS: dict[str, dict[str, object]] = {
    "cell_line": {"ontology_file": "ontology/cellosaurus.obo"},
    "disease": {"ontology_file": "ontology/mondo.obo"},
    "tissue": {"ontology_file": "ontology/uberon.obo"},
    "drug": {"ontology_file": "ontology/chebi.obo", "value_type": "array"},
    "chip_antigen": {"ontology_file": "ontology/gene.obo", "value_type": "array"},
}

# (term_id, label, synonyms, parents)
ONTOLOGIES: dict[str, list[tuple[str, str, list[str], list[str]]]] = {
    "cellosaurus": [
        ("CVCL:0027", "HepG2", ["Hep G2"], []),
        ("CVCL:0004", "K-562", ["K562"], []),
        ("CVCL:0031", "MCF-7", ["MCF7"], []),
        ("CVCL:0030", "HeLa", [], []),
    ],
    "mondo": [
        ("MONDO:0000001", "disease", [], []),
        ("MONDO:0004992", "cancer", ["malignant neoplasm", "carcinoma"], ["MONDO:0000001"]),
        ("MONDO:0007254", "breast cancer", ["mammary cancer"], ["MONDO:0004992", "MONDO:0002657"]),
        ("MONDO:0002657", "breast disorder", [], ["MONDO:0000001"]),
        ("MONDO:0004989", "breast carcinoma", [], ["MONDO:0007254"]),
        ("MONDO:0005061", "lung adenocarcinoma", ["LUAD"], ["MONDO:0004992"]),
        ("MONDO:0005148", "type 2 diabetes mellitus", ["T2D"], ["MONDO:0000001"]),
    ],
    "uberon": [
        ("UBERON:0000061", "anatomical structure", [], []),
        ("UBERON:0002107", "liver", [], ["UBERON:0000061"]),
        ("UBERON:0002048", "lung", [], ["UBERON:0000061"]),
        ("UBERON:0000178", "blood", ["peripheral blood"], ["UBERON:0000061"]),
        ("UBERON:0003661", "limb muscle", ["skeletal muscle"], ["UBERON:0000061"]),
    ],
    "chebi": [
        ("CHEBI:23888", "drug", [], []),
        ("CHEBI:28748", "doxorubicin", ["adriamycin"], ["CHEBI:23888"]),
        ("CHEBI:41879", "dexamethasone", ["dex"], ["CHEBI:23888"]),
        ("CHEBI:41774", "tamoxifen", [], ["CHEBI:23888"]),
    ],
    "gene": [
        ("NCBIGene:10664", "CTCF", [], []),
        ("NCBIGene:23476", "BRD4", [], []),
        ("NCBIGene:2146", "EZH2", [], []),
    ],
}

# Terms whose parents the ontology files write as part-of relations: `part_of` for the first, `BFO:0000050` for the
# second. The hierarchy is the same as if they were written as is-a.
PART_OF_RELATION = {"UBERON:0000178": "part_of", "UBERON:0003661": "BFO:0000050"}

LABELS = {term_id: label for terms in ONTOLOGIES.values() for term_id, label, _, _ in terms}
SYNONYMS = {term_id: synonyms for terms in ONTOLOGIES.values() for term_id, _, synonyms, _ in terms}


def term_tier(term_id: str, query: str) -> int:
    """How a term matches a search query, from the synthetic labels and synonyms and not from an API response.

    0 when the label or the ID is the query, 1 when a synonym is, 2 when the label or the ID contains it, else 3.
    """
    text = query.casefold()
    label = LABELS[term_id].casefold()
    if text in (label, term_id.casefold()):
        return 0
    if text in {s.casefold() for s in SYNONYMS[term_id]}:
        return 1
    if text in label or text in term_id.casefold():
        return 2
    return 3


# The first synonym of each term that has one. Every seventh BioSample writes it in place of an extracted value with
# the term, so that the value has evidence only through the names of its term, or through its own text with a strategy
# after `exact` (`Hep G2` for `HepG2`).
SYNONYM_OF = {term_id: synonyms[0] for terms in ONTOLOGIES.values() for term_id, _, synonyms, _ in terms if synonyms}

# Leaf-ish terms the generator annotates with, per field.
ANNOTATED: dict[str, list[tuple[str, str]]] = {
    "cell_line": [(t, label) for t, label, _, _ in ONTOLOGIES["cellosaurus"]],
    "disease": [(t, label) for t, label, _, _ in ONTOLOGIES["mondo"] if t != "MONDO:0000001"],
    "tissue": [(t, label) for t, label, _, _ in ONTOLOGIES["uberon"] if t != "UBERON:0000061"],
    "drug": [(t, label) for t, label, _, _ in ONTOLOGIES["chebi"] if t != "CHEBI:23888"],
    "chip_antigen": [(t, label) for t, label, _, _ in ONTOLOGIES["gene"]],
}
ASSAYS = ["RNA-Seq", "ChIP-Seq", "ATAC-seq", "Bisulfite-Seq", "WGS"]
TARGET_ASSAYS = ["RNA-Seq", "ChIP-Seq", "ATAC-seq"]
ORGANISMS = [(9606, "Homo sapiens"), (10090, "Mus musculus")]
# Names that a few BioSamples give instead, which sort before the names that most BioSamples give.
ORGANISM_VARIANTS = {9606: "9606", 10090: "Mouse"}
STATUS_KINDS = ("mapped_exact", "mapped_selected", "unmapped_no_candidate", "unmapped_rejected", "not_stated")


RUN_START = datetime.datetime(2026, 1, 1)
"""The start time (UTC) of every generated run. A later publication date is not the day a BioSample became public."""

PUBLICATION_BOUNDARIES = (
    datetime.datetime(2005, 1, 1),
    datetime.datetime(2005, 1, 2),
    datetime.datetime(2026, 1, 2),
    datetime.datetime(2026, 1, 3),
)
"""Local (+09:00) midnights around the bounds, whose UTC dates are 2004-12-31, 2005-01-01, 2026-01-01, 2026-01-02."""


@dataclass(slots=True)
class Truth:
    """What the generator decided, keyed for assertions."""

    annotations: dict[tuple[str, str, str], list[tuple[str | None, str, str | None]]] = field(default_factory=dict)
    modified: dict[tuple[str, str], datetime.datetime] = field(default_factory=dict)
    published: dict[tuple[str, str], datetime.date | None] = field(default_factory=dict)
    published_input: dict[tuple[str, str], datetime.date | None] = field(default_factory=dict)
    experiments: dict[str, list[tuple[str, str]]] = field(default_factory=dict)
    bioprojects: dict[str, list[str]] = field(default_factory=dict)


@dataclass(slots=True)
class Synthetic:
    root: Path
    manifest: Path
    run_names: list[str]
    truth: Truth
    accessions: list[str]

    def manifest_with_runs(self, names: list[str], out: Path) -> Path:
        text = self.manifest.read_text()
        head, _, _ = text.partition("runs:\n")
        _, _, tail = text.partition("reference:\n")
        runs = "".join(_run_block(n) for n in names)
        out.write_text(head + "runs:\n" + runs + "reference:\n" + tail)
        return out


def _run_block(name: str) -> str:
    return (
        f"  - name: {name}\n"
        f"    result: results/select_{name}.json\n"
        f"    input: inputs/{name}.jsonl\n"
        f"    select_config: config/select-config.json\n"
        f"    mk2_version: abc1234\n"
    )


def generate(root: Path, *, seed: int = 0, n_biosamples: int = 120, n_runs: int = 3, overlap: float = 0.2) -> Synthetic:
    """Write a complete dataset under `root` and return its description."""
    rng = random.Random(seed)
    for sub in ("results", "inputs", "config", "ontology", "reference/sra", "reference/bioproject", "store"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    _write_config(root)
    _write_ontologies(root)
    truth = Truth()
    accessions = [f"SAMN{seed:02d}{i:06d}" for i in range(n_biosamples)]
    run_names = [f"run{r + 1}" for r in range(n_runs)]
    per_run: list[list[str]] = []
    chunk = max(1, n_biosamples // n_runs)
    for r in range(n_runs):
        own = accessions[r * chunk : (r + 1) * chunk] if r < n_runs - 1 else accessions[r * chunk :]
        shared = rng.sample(accessions, k=int(len(accessions) * overlap)) if r > 0 else []
        per_run.append(sorted(set(own) | set(shared)))
    for name, members in zip(run_names, per_run, strict=True):
        _write_run(root, name, members, rng, truth)
    _write_reference(root, accessions, rng, truth)
    manifest = root / "manifest.yaml"
    manifest.write_text(
        "name: synthetic\n"
        f"target_assays: [{', '.join(TARGET_ASSAYS)}]\n"
        "runs:\n" + "".join(_run_block(n) for n in run_names) + "reference:\n"
        "  ontologies:\n"
        + "".join(
            f'    - name: {name}\n      files: [ontology/{name}.obo]\n      snapshot_date: "2026-01-01"\n'
            for name in ONTOLOGIES
        )
        + '  sra_experiments:\n    path: reference/sra\n    snapshot_date: "2026-01-02"\n'
        '  dblink:\n    path: reference/dblink.duckdb\n    snapshot_date: "2026-01-03"\n'
        '  bioprojects:\n    path: reference/bioproject\n    snapshot_date: "2026-01-04"\n'
        '  chip_atlas:\n    path: reference/experimentList.tab\n    snapshot_date: "2026-01-05"\n'
    )
    return Synthetic(root=root, manifest=manifest, run_names=run_names, truth=truth, accessions=accessions)


def _write_config(root: Path) -> None:
    (root / "config" / "select-config.json").write_text(json.dumps({"fields": FIELDS}, indent=1))


def _write_ontologies(root: Path) -> None:
    for name, terms in ONTOLOGIES.items():
        lines = ["format-version: 1.2", ""]
        for term_id, label, synonyms, parents in terms:
            lines += ["[Term]", f"id: {term_id}", f"name: {label}"]
            lines += [f'synonym: "{s}" EXACT []' for s in synonyms]
            relation = PART_OF_RELATION.get(term_id)
            if relation is None:
                lines += [f"is_a: {p} ! parent" for p in parents]
            else:
                lines += [f'relationship: {relation} {p} {{source="x"}} ! parent' for p in parents]
            lines.append("")
        lines += ["[Term]", "id: OBS:1", "name: obsolete", "is_obsolete: true", ""]
        (root / "ontology" / f"{name}.obo").write_text("\n".join(lines))


def _timing() -> dict[str, int]:
    return {"total_duration": 1, "load_duration": 0, "eval_count": 1, "eval_duration": 1, "prompt_eval_count": 1}


def _candidate(term_id: str, label: str) -> dict[str, object]:
    return {
        "term_uri": f"http://purl.obolibrary.org/obo/{term_id.replace(':', '_')}",
        "term_id": term_id,
        "prop_uri": "http://www.w3.org/2000/01/rdf-schema#label",
        "value": label,
        "label": label,
        "exact_match": True,
        "text2term_score": None,
        "reasoning": None,
        "comments": None,
        "definitions": None,
    }


def _write_run(root: Path, name: str, members: list[str], rng: random.Random, truth: Truth) -> None:
    entries: list[dict[str, object]] = []
    inputs: list[str] = []
    for accession in members:
        number = int(accession[4:])
        organism = rng.choice(ORGANISMS)
        organism_name = ORGANISM_VARIANTS[organism[0]] if number % 7 == 0 else organism[1]
        modified = datetime.datetime(2020, 1, 1) + datetime.timedelta(days=rng.randrange(2000))
        roll = rng.random()
        if roll < 0.05:
            published_local = datetime.datetime(1999, 1, 1) + datetime.timedelta(days=rng.randrange(2000))
        elif roll < 0.10:
            published_local = RUN_START + datetime.timedelta(days=rng.randrange(2, 4000))
        elif roll < 0.15:
            published_local = rng.choice(PUBLICATION_BOUNDARIES)
        else:
            published_local = datetime.datetime(2010, 1, 1) + datetime.timedelta(days=rng.randrange(5000))
        submitted = published_local + datetime.timedelta(days=rng.randrange(-30, 400))
        truth.modified[(name, accession)] = modified
        has_published = rng.random() >= 0.05
        # The publication date is written at local midnight (+09:00), so its UTC date is the previous day.
        published_utc = (published_local - datetime.timedelta(hours=9)).date() if has_published else None
        truth.published_input[(name, accession)] = published_utc
        truth.published[(name, accession)] = (
            published_utc
            if published_utc is not None and datetime.date(2005, 1, 1) <= published_utc <= RUN_START.date()
            else None
        )
        attributes = [
            {"attribute_name": "sample_name", "content": f"sample {accession}"},
            # An attribute that records how the BioSample was archived, which the derived BioSample leaves out.
            {"attribute_name": "GEO Accession", "content": f"GSM{accession[4:]}"},
        ]
        title = f"{name} sample of {accession}"
        failed = rng.random() < 0.03
        extracted: dict[str, object] | None = None if failed else {}
        results: dict[str, list[dict[str, object]]] = {f: [] for f in FIELDS}
        timings: dict[str, dict[str, object]] = {f: {} for f in FIELDS}
        search: dict[str, dict[str, list[dict[str, object]]]] = {f: {} for f in FIELDS}
        text2term: dict[str, dict[str, list[dict[str, object]]]] = {f: {} for f in FIELDS}
        mentions: list[str] = []
        for field_name, spec in FIELDS.items():
            key = (name, accession, field_name)
            if extracted is None:
                truth.annotations[key] = [(None, "extraction_failed", None)]
                continue
            multi = spec.get("value_type") == "array"
            n_values = rng.choice([0, 0, 1, 1, 1, 2, 3]) if multi else rng.choice([0, 0, 1, 1, 1])
            if n_values == 0:
                extracted[field_name] = None
                truth.annotations[key] = [(None, "not_stated", None)]
                continue
            values: list[str] = []
            written: list[str] = []
            rows: list[tuple[str | None, str, str | None]] = []
            for term_id, label in rng.sample(ANNOTATED[field_name], k=min(n_values, len(ANNOTATED[field_name]))):
                status = rng.choice(STATUS_KINDS[:4])
                value = label if status == "mapped_exact" else f"{label} ({rng.randrange(100)})"
                values.append(value)
                mapped = status.startswith("mapped")
                written.append(SYNONYM_OF[term_id] if number % 7 == 0 and mapped and term_id in SYNONYM_OF else value)
                attributes.append({"attribute_name": field_name, "content": f"{written[-1]} treated"})
                if status.startswith("mapped"):
                    results[field_name].append(
                        {
                            "value": value,
                            "term_id": term_id,
                            "term_uri": None,
                            "label": label,
                            "exact_match": True,
                            "reasoning": None,
                        }
                    )
                    if status == "mapped_selected":
                        timings[field_name][value] = _timing()
                        search[field_name][value] = [_candidate(term_id, label), _candidate("MONDO:0000001", "disease")]
                    else:
                        search[field_name][value] = [_candidate(term_id, label)]
                    rows.append((value, status, term_id))
                else:
                    if status == "unmapped_rejected":
                        text2term[field_name][value] = [_candidate(term_id, label)]
                    else:
                        search[field_name][value] = []
                    rows.append((value, status, None))
            extracted[field_name] = values if multi else values[0]
            truth.annotations[key] = rows
            mentions.append(written[0])
            if field_name == "disease":
                # Attributes among the names that bsllmner-mk2 drops. `study disease` always holds an extracted
                # value, and `Submitter Id` holds one only in every other BioSample.
                attributes.append({"attribute_name": "study disease", "content": written[0]})
                submitter = written[0] if number % 2 == 0 else f"submitter {accession}"
                attributes.append({"attribute_name": "Submitter Id", "content": submitter})
        entries.append(
            {
                "extract": {
                    "accession": accession,
                    "extracted": extracted,
                    "raw_output": None,
                    "llm_timing": _timing(),
                },
                "search_results": search,
                "text2term_results": text2term,
                "select_timings": timings,
                "results": results,
                "ambiguous_fields": {},
            }
        )
        # In every fifth BioSample, only the name of the owner holds the last mention, so that its evidence is in the
        # record. A contact always holds a mention and is never kept.
        only_in_record = mentions[-1] if number % 5 == 0 and mentions else None
        if only_in_record is not None:
            attributes = [a for a in attributes if only_in_record not in a["content"]]
        description: dict[str, object] = {
            "Title": title,
            "Organism": {"taxonomy_id": str(organism[0]), "OrganismName": organism_name},
        }
        # A paragraph that holds an extracted value, or a list of paragraphs that hold none.
        if number % 3 == 0 and mentions and mentions[0] != only_in_record:
            description["Comment"] = {"Paragraph": f"Profiling of {mentions[0]} samples"}
        elif number % 3 == 1:
            description["Comment"] = {"Paragraph": [f"first paragraph of {accession}", "second paragraph"]}
        if number % 4 == 0:
            description["SampleName"] = f"name of {accession}"
        if number % 11 == 0:
            description["Synonym"] = [{"db": "SYN", "content": f"synonym of {accession}"}]
        owner_name = f"Laboratory of {only_in_record}" if only_in_record is not None else "Synthetic Institute"
        contact = mentions[0] if mentions else "Ann"
        body: dict[str, object] = {
            "access": "public",
            "last_update": modified.isoformat() + "+00:00",
            "submission_date": submitted.isoformat(),
            "Ids": {"Id": [{"namespace": "BioSample", "content": accession}]},
            "Description": description,
            "Owner": {"Name": {"content": owner_name}, "Contacts": {"Contact": {"Name": {"First": contact}}}},
            "Status": {"status": "live", "when": "2020-01-01T00:00:00"},
            "Attributes": {"Attribute": attributes},
        }
        if has_published:
            body["publication_date"] = published_local.isoformat() + "+09:00"
        wrapped = (
            {"BioSample": body, "accession": accession} if rng.random() < 0.5 else {**body, "accession": accession}
        )
        inputs.append(json.dumps(wrapped))
    (root / "results" / f"select_{name}.json").write_text(
        json.dumps(
            {
                "entries": entries,
                "run_metadata": {
                    "run_name": name,
                    "model": "synthetic-model:1",
                    "thinking": False,
                    "start_time": RUN_START.isoformat() + "Z",
                    "end_time": "2026-01-01T01:00:00Z",
                    "status": "completed",
                    "processing_time_sec": 3600.0,
                    "total_entries": len(entries),
                },
                "evaluation": None,
                "performance": None,
                "errors": [],
            }
        )
    )
    (root / "inputs" / f"{name}.jsonl").write_text("\n".join(inputs) + "\n")


def _write_reference(root: Path, accessions: list[str], rng: random.Random, truth: Truth) -> None:
    edges: list[tuple[str, str, str, str]] = []
    experiments: list[dict[str, object]] = []
    chip: list[str] = []
    bioprojects = [f"PRJNA{i:06d}" for i in range(max(3, len(accessions) // 8))]
    titles = {bp: f"Project {bp} about {rng.choice(['cancer', 'liver', 'immune cells'])}" for bp in bioprojects}
    n_srx = 0
    for accession in accessions:
        n_exp = rng.choice([0, 1, 1, 1, 2, 3])
        truth.experiments[accession] = []
        for _ in range(n_exp):
            n_srx += 1
            srx = f"SRX{n_srx:07d}"
            assay = rng.choice(ASSAYS)
            truth.experiments[accession].append((srx, assay))
            edges.append(("biosample", accession, "sra-experiment", srx))
            experiments.append({"identifier": srx, "type": "sra-experiment", "libraryStrategy": [assay], "dbXrefs": []})
            for r in range(rng.choice([1, 1, 2])):
                edges.append(("sra-experiment", srx, "sra-run", f"SRR{n_srx:07d}{r}"))
            if assay in ("ChIP-Seq", "ATAC-seq") and rng.random() < 0.7:
                chip.append(f"{srx}\thg38\tHistone\tH3K27ac\tCell line\tHepG2\tNA\t1,2,3\ttitle")
        bps = rng.sample(bioprojects, k=rng.choice([0, 1, 1, 2]))
        truth.bioprojects[accession] = bps
        edges += [("biosample", accession, "bioproject", bp) for bp in bps]
    (root / "reference" / "sra" / "ncbi_experiment_0001.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in experiments)
    )
    (root / "reference" / "sra" / "ncbi_run_0001.jsonl").write_text('{"identifier": "SRR0", "type": "sra-run"}\n')
    (root / "reference" / "bioproject" / "ncbi_1.jsonl").write_text(
        "".join(json.dumps({"identifier": bp, "type": "bioproject", "title": titles[bp]}) + "\n" for bp in bioprojects)
    )
    (root / "reference" / "experimentList.tab").write_text("\n".join(chip) + "\n")
    db = root / "reference" / "dblink.duckdb"
    if db.exists():
        db.unlink()
    con = duckdb.connect(str(db))
    con.execute(
        "CREATE TABLE dbxref (accession_type VARCHAR, accession VARCHAR, linked_type VARCHAR, linked_accession VARCHAR)"
    )
    con.executemany("INSERT INTO dbxref VALUES (?, ?, ?, ?)", [*edges, *[(c, d, a, b) for a, b, c, d in edges]])
    con.close()
