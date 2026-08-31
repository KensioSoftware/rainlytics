// `rainlytics report`, which reads one precomputed calendar report.

import type { Command, CommandContext } from "./command.js";
import type { JsonDocumentResult } from "./output/result.js";
import { reportDescription, reportOptions } from "./report-help.js";
import { readReport } from "./report-lookup.js";
import { reportReadReport } from "./report-report.js";
import { reportRequestFrom } from "./report-request.js";

/** Reads a report and keeps its versioned document as the JSON result. */
async function run(context: CommandContext): Promise<JsonDocumentResult> {
  const asked = reportRequestFrom(context);
  const read = await readReport(asked.bucket, asked.region, asked.period);

  context.io.error(reportReadReport(read, new Date()));

  return { kind: "json-document" as const, document: read.document };
}

/** `rainlytics report`, for one closed calendar period. */
export const reportCommand: Command = {
  name: "report",
  summary: "Read a precomputed calendar report.",
  usage: "rainlytics report <day|week|month|year> <date> [options]",
  description: reportDescription,
  options: reportOptions,
  run,
};
