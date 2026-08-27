// Assembling one help page.
//
// The prose lives in `help-text.ts` and the wrapping in `text-layout.ts`.
// What is here is the order the sections come in, and the command and option
// lists, which are generated from `command.ts` and `option.ts`. Adding a flag
// therefore means writing down what it does.

import type { Command } from "./command.js";
import {
  footer,
  noCommandsYet,
  overview,
  readingOneCommand,
} from "./help-text.js";
import { type CliOption, commonOptions, rootOptions } from "./option.js";
import {
  indent,
  indented,
  paragraph,
  prose,
  twoColumn,
} from "./text-layout.js";

/** How an option is spelled in help, as `-o, --output <format>`. */
function flagsOf(option: CliOption): string {
  const short = option.short === undefined ? "    " : `-${option.short}, `;
  const value =
    option.type === "string" ? ` <${option.valueName ?? "value"}>` : "";

  return `${short}--${option.name}${value}`;
}

/** The `Options:` section for a set of options. */
function optionsSection(options: readonly CliOption[]): string {
  const entries = options.map((option) => ({
    label: flagsOf(option),
    description: option.description,
  }));

  return `Options:\n${twoColumn(entries)}`;
}

/** The `Commands:` section, or the note standing in for it. */
function commandsSection(commands: readonly Command[]): string {
  if (commands.length === 0) {
    return `Commands:\n${indented(noCommandsYet)}`;
  }

  const entries = commands.map((command) => ({
    label: command.name,
    description: command.summary,
  }));

  return `Commands:\n${twoColumn(entries)}`;
}

/** The help for `rainlytics` itself. */
export function rootHelp(commands: readonly Command[]): string {
  const sections = [
    `Usage:\n${indent}rainlytics <command> [options]`,
    ...overview.map((text) => paragraph(text)),
    commandsSection(commands),
    optionsSection([...rootOptions]),
    paragraph(readingOneCommand),
    paragraph(footer),
  ];

  return `${sections.join("\n\n")}\n`;
}

/** The help for one subcommand. */
export function commandHelp(command: Command): string {
  const usage = command.usage ?? `rainlytics ${command.name} [options]`;

  const sections = [
    `Usage:\n${indent}${usage}`,
    paragraph(command.summary),
    prose(command.description),
    optionsSection([...commonOptions, ...(command.options ?? [])]),
    paragraph(footer),
  ];

  return `${sections.join("\n\n")}\n`;
}
