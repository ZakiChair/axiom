import { FluxCapitaux } from "../onchain/FluxCapitaux";
import { TitreSection } from "../ui";

export function SectionFluxCapitaux() {
  return <section className="space-y-2"><TitreSection>Flux · lecture commune</TitreSection><FluxCapitaux titre={false} /></section>;
}
