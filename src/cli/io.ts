// Where the CLI writes, and the one thing it knows about where it is running.
//
// Two streams with different jobs. Standard output carries the result of the
// command and nothing else, so a pipeline reads data and never prose.
// Everything else goes to standard error, including help, warnings and the
// message that comes with a non-zero exit.
//
// This is an interface and not a reach for `process`, because the tests drive
// the whole CLI through it and read back exactly what a shell would have seen.

/** The two streams a command line writes to, and whether anyone is watching. */
export interface CliIo {
  /** Writes to standard output, which carries the result and nothing else. */
  readonly out: (text: string) => void;

  /** Writes to standard error, which carries help, warnings and failures. */
  readonly error: (text: string) => void;

  /**
   * Whether standard output is a terminal.
   *
   * This picks the default output format. A person reading a terminal wants a
   * table, and a program reading a pipe wants JSON. `defaultOutputFormat`
   * in `output/format.ts` applies it.
   */
  readonly outIsTerminal: boolean;
}
