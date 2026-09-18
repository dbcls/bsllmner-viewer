import { useParams } from "react-router"

import { SamplePage } from "~/features/sample"

const SampleRoute = () => {
  const { accession } = useParams<"accession">()

  return <SamplePage accession={accession ?? ""} />
}

export default SampleRoute
