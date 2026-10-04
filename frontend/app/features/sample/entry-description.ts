import type { EntryResponse } from "~/lib/api/types"
import { fieldLabel } from "~/lib/labels"

/**
 * The summary of a BioSample page for search results: the BioSample with its organism, and then the labels of the terms
 * of its annotations, one sentence per field, in the order of the api. A label that a field has twice is written once.
 */
export const entryDescription = (entry: EntryResponse): string => {
  const organism = entry.organism?.name
  const subject = organism ? `BioSample ${entry.identifier} (${organism})` : `BioSample ${entry.identifier}`
  const labels = new Map<string, string[]>()
  for (const { field, label } of entry.annotations) {
    if (label === null) continue
    const ofField = labels.get(field) ?? []
    if (!ofField.includes(label)) ofField.push(label)
    labels.set(field, ofField)
  }
  if (labels.size === 0) return `The original metadata of ${subject} and the values that bsllmner-mk2 extracted from it.`
  const fields = [...labels].map(([field, ofField]) => `${fieldLabel(field)}: ${ofField.join(", ")}.`)
  return [`Ontology terms of ${subject}.`, ...fields].join(" ")
}
