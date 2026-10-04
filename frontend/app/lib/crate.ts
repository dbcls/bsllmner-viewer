/** An organization, named as it names itself in English, and its English site. */
export type Organization = { name: string; url: string }

/** The organization that runs bsllmner-mk2 and made the annotations of the RO-Crate. */
export const DBCLS: Organization = { name: "Database Division for Life Science (DBCLS)", url: "https://dbcls.rois.ac.jp/index-en.html" }

/**
 * The RO-Crate that publishes the annotations of the dataset, with the license of the annotations and the organization
 * that made them. These values are written in the frontend, not read from `/api/dataset`, so another dataset needs them
 * changed by hand.
 */
export const ANNOTATION_CRATE = {
  name: "BioSample Plus",
  url: "https://biosampleplus.s3.ap-northeast-1.amazonaws.com/index.html",
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  creator: DBCLS,
} as const
