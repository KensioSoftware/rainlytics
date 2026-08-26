// The words in the help, kept apart from the code that lays them out.
//
// AGENTS.md asks that `--help` explain the tool well enough that a reader
// needs nothing else. This file is that explanation, and it is meant to be
// edited as prose.

/** What `rainlytics --help` says above the lists. */
export const overview: readonly string[] = [
  "Rainlytics keeps a site's analytics in the site's own AWS account." +
    " CloudFront delivers the access logs to S3 and this command reads them" +
    " back. Nothing is sent anywhere else, and no analytics JavaScript is" +
    " served to the pages being measured.",
  "Authentication is the AWS setup you already have. Rainlytics uses the AWS" +
    " SDK's default credential chain, the same one the AWS CLI uses. An SSO" +
    " session, a profile named in AWS_PROFILE, an assumed role or the" +
    " credentials of the machine it runs on all work with nothing configured" +
    " here. There is no Rainlytics account, password or API key, and" +
    " CloudTrail records who asked what.",
  "Output is JSON, CSV or a table, picked with --output on any command. It" +
    " defaults to a table when standard output is a terminal and to JSON" +
    " when it is piped or redirected. Piping into jq therefore needs no" +
    " flag.",
  "A command writes its result to standard output and everything else to" +
    " standard error. A pipeline reads data and never prose. A command that" +
    " fails exits non-zero (2 for a command line that could not be read, 1" +
    " for a command that ran and could not finish).",
];

/** What stands in for the command list until there are commands. */
export const noCommandsYet =
  "None yet. This release is the command line itself, being the argument" +
  " parsing, the output formats, the help and the exit codes. Reading the" +
  " data back arrives with the next one.";

/** How to read one command on its own. */
export const readingOneCommand =
  'Run "rainlytics <command> --help" for one command on its own. Options' +
  " come after the command they belong to.";

/** Where to read more, at the foot of every help page. */
export const footer =
  "Rainlytics is experimental and pre-1.0. See https://rainlytics.com";
