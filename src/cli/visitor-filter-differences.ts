// Where two questions differ over which visitors were real.
//
// Apart from `summary-question.ts`, which compares every counting filter and
// grew past the complexity budget when the rendered filter joined it. These
// three decide whose traffic counts at all, rather than which part of the
// site or which country.

import type { SummaryQuestion } from "../rollup-summaries.js";
import { botText, botUserAgentText, renderedText } from "./question-text.js";
import type { QuestionDifference } from "./summary-question.js";
import { differing } from "./summary-question.js";

/**
 * Where two questions differ over crawlers and over rendering.
 *
 * `--bot-user-agent` is compared only where neither side counted crawlers.
 * A question counting everything has no use for a list of what to leave out,
 * and one counting crawlers beside one leaving them out already differs on
 * `--include-bots`.
 *
 * `--rendered-only` is compared whatever the bot filter says. It judges the
 * visitor behind a row and the bot filter judges the row, so the two narrow
 * independently.
 */
export function visitorFilterDifferences(
  asked: SummaryQuestion,
  computed: SummaryQuestion,
): readonly QuestionDifference[] {
  return [
    ...differing(
      "--include-bots",
      botText(asked.includeBots),
      botText(computed.includeBots),
    ),
    ...(asked.includeBots || computed.includeBots
      ? []
      : differing(
          "--bot-user-agent",
          botUserAgentText(asked.botUserAgents),
          botUserAgentText(computed.botUserAgents),
        )),
    ...differing(
      "--rendered-only",
      renderedText(asked.renderedOnly),
      renderedText(computed.renderedOnly),
    ),
  ];
}
