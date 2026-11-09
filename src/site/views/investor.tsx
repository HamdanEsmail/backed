// An investor in a search: the white sheet at full length. Every deal with its quotation, its source
// and its sum; the rounds they joined; a cheque size only when their own site states one; the way
// in; the first line.
import { stageInText, STAGES, type Stage } from "../../core/stages";
import type { InvestorView, SearchView } from "../../search/read";
import { FirstSheet } from "../components";
import { money, roundStage } from "../format";
import { Footer, Layout, Nav } from "../layout";
import { ReadStage } from "./search";

/** "seed and Series A rounds of $3.5M to $7M", from the rounds found in this search. */
export function roundsJoined(inv: InvestorView): string {
  const stages = STAGES.filter((s) => inv.deals.some((d) => roundStage(d.round_type) === s)) as Stage[];
  const words = stages.map(stageInText);
  const kinds = words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  const lo = money(inv.rounds.min_usd);
  const hi = money(inv.rounds.max_usd);
  const size = lo === null ? ", amounts not stated" : lo === hi ? ` of ${lo}` : ` of ${lo} to ${hi}`;
  return `${kinds} ${stages.length === 1 && inv.deals.length === 1 ? "round" : "rounds"}${size}`;
}

export function InvestorPage(props: { view: SearchView; inv: InvestorView; saved: number }) {
  const { view, inv } = props;
  const back = `/searches/${view.search.id}`;
  return (
    <Layout title={`Backed: ${inv.name}, for ${view.search.line}`} description={`Why ${inv.name} ranks for this line, with every deal and its proof.`} noindex={view.search.demo === null}>
      <div class="split">
        <ReadStage view={view} />
        <div class="col">
          <Nav home={false} className="top" />
          <section class="block lead-in ranked-end">
            <p class="said">
              <a href={`${back}#list`}>All {view.investors.length} investors for this line</a>
            </p>
            <FirstSheet inv={inv} total={view.investors.length} view={view} href={null}>
              <p class="facts">
                <b>Rounds they joined here:</b> {roundsJoined(inv)}. A cheque size is shown only when their own site states one.
              </p>
            </FirstSheet>
          </section>
        </div>
      </div>
      <Footer saved={props.saved} />
    </Layout>
  );
}
