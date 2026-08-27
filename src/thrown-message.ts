// What something thrown said.
//
// Shared because everything that catches has the same problem. Anything at
// all can be thrown, and the SDKs and the runtime between them throw plenty
// besides an `Error`. The command line reports one to a person and the
// scheduled job puts one in a log, and both start from a sentence.

/** The message something thrown carries, whatever it was. */
export function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
