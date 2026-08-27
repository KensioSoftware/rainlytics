# Rollups

The questions the command line answers without anybody writing SQL.

```bash
rainlytics pageviews --last 7d
```

```text
path         views
-----------  -----
/              412
/liju/         208
/grammar/       97
```

`referrers`, `status-codes`, `cache-hit-ratio` and [`searches`](../searches/) are the others. Each takes the same
`--last`, the same `--path` and `--host`, the same output formats and the same bot filter, and each
reports what it scanned and what that cost on standard error.

## What each one counts

**`pageviews`** counts the pages people looked at. A pageview is a GET that answered HTML and
succeeded, which is what separates a page from the images, stylesheets and fonts the same log
records. A 304 counts, because a browser being told its copy is current is somebody looking at the
page. The path is decoded, for the reason under [The log is percent-encoded
twice](#the-log-is-percent-encoded-twice) below.

**`referrers`** counts where people arrived from, by host. Requests carrying no referrer are left
out, and so are the ones this site sent itself. Those are somebody moving around inside it. On the
reference site an unfiltered version of this is topped by its own stylesheet.

**`status-codes`** counts every response, including the assets the pageview count leaves out. A
stylesheet returning 404 is worth seeing and a rollup looking only at pages never would.

**`cache-hit-ratio`** counts over the requests the cache had a say in, being a Hit, a RefreshHit or
a Miss. A redirect, an error and a response a CloudFront Function generated are requests the cache
was never asked about, and counting them would move the ratio without the cache having changed.

## The log is percent-encoded twice

CloudFront percent-encodes every value it writes into a log record, and a request URI reaches it
already carrying the browser's own encoding. A page at `/words/好/` is requested as
`/words/%E5%A5%BD/` and recorded as `/words/%25E5%25A5%25BD/`.

`pageviews` decodes the path twice, so it reports the address a reader would recognise. One pass
answers `/words/%E5%A5%BD/`. That is the URI the browser sent, and it reads no better than the
record. A site whose addresses are all ASCII sees the same table either way.

Only `pageviews` reads a column carrying the encoding. `referrers` reads a referrer for its host,
and a host is ASCII whatever the rest of the URL holds. A status code and a result type arrive
plain. The crawler filter matches ASCII substrings of a user agent and reads an encoded one the
same way.

Two limits are worth knowing. `url_decode` reads `+` as a space. That is right for a query string
and wrong for a path, where `+` is a literal. Athena also raises over an escape naming no byte,
such as `%zz`. A path carrying one that still answered HTML would fail the query outright. Both
stayed theoretical across 137,000 records of real traffic.

## Crawlers are most of the traffic

Every rollup leaves automated traffic out by default. That is a judgement, and here it is.

One hour of the reference site in August 2026 held 9,492 requests. 3,748 of them matched the bot
filter, and 1,951 were a single crawler. Bots were 39% of the hour and the largest single user agent
on the site. An unfiltered pageview count is not the raw number with the opinions taken out. It is a
number that says more about crawlers than about anybody who reads the site.

The filter matches four substrings against a lowercased `cs(User-Agent)`:

```text
bot|crawl|spider|slurp
```

Substrings, because a crawler names itself `ClaudeBot/1.0` with the token glued to a word, which
a whole-word match would walk past. The cost is a device whose name happens to contain one, and the
Cubot range of Android phones is the example. Count it both ways to see how much of the difference is yours:

```bash
rainlytics pageviews --last 7d --include-bots
```

`status-codes` is the one where `--include-bots` is usually what you want. Bots find the broken
links first and in numbers.

## `--path` and `--host` narrow the question

`--path` counts one section of a site, as a prefix of the address:

```bash
rainlytics pageviews --path /guides/ --last 30d
```

It matches the address a reader sees. The record holds it percent-encoded twice, and the filter
decodes before comparing, so `--path /词典/` finds the pages `pageviews` prints under that name. The
text is taken literally. A path holding `_` or `%` matches itself.

Give `--path` again for each section that belongs in one answer. A request counts when its address
starts with any of them:

```bash
rainlytics pageviews --path /guides/ --path /tutorials/ --last 7d
```

Guides and tutorials are one section of a site to whoever writes them, and a site with search boxes
at `/words/search/` and `/sentences/search/` has no prefix covering both. Each path becomes its own
prefix test and the tests are joined by `OR`. One `--path` writes what it always wrote.

An answer counting several sections together says nothing about which of them a row came from.
[`searches`](../searches/) names the section on every row when it is given more than one, and a
rollup of your own gets the same column from [`matchedPath`](#naming-the-section-a-row-came-from).

`--host` counts one of the sites a single distribution serves:

```bash
rainlytics status-codes --host docs.example.com --last 7d
```

That one matches in full. A site and its `www` name are two hosts, and folding them together is a
decision for whoever runs them rather than a default. `x-host-header` is in the delivered field set
for exactly this, and nothing else in a record says which site was asked for.

Neither option changes what a query costs. `--last` has already decided which partitions are read,
and these two narrow rows that are paid for either way. Narrowing to one section of a busy site
gives a shorter answer for the same money.

## `--last` decides what the question costs

A range becomes partition predicates rather than a filter on the record's own timestamp. `--last 7d`
over a year of logs reads seven days of objects. The same range written `WHERE timestamp_ms > ...`
answers identically and reads the year to do it, which is the mistake the whole partition layout
exists to prevent.

```bash
rainlytics pageviews --last 24h
rainlytics referrers --last 2w
rainlytics status-codes --last 4w --include-bots
```

Whole hours, days or weeks. There is no month, because a month is not a fixed length and a range
that quietly meant thirty days would be worse than one nobody could ask for.

The predicate a range builds names each partition key separately:

```sql
WHERE year IN ('2026')
  AND month IN ('08', '09')
  AND day IN ('28', '29', '30', '31', '01', '02', '03')
  AND cast(timestamp_ms AS bigint) BETWEEN 1787875200000 AND 1788436800000
```

Those are a cross product. A week spanning a month boundary asks for seven days in two months and
reads fourteen partitions, and the timestamp condition after them is what keeps the answer exact. The
alternative is one predicate per day joined by `OR`, which reads exactly the seven and which Athena
plans more slowly the longer the range gets. Fourteen partitions against a year of them is still the
difference the layout exists to make.

## The same SQL, saved in the console

The `RollupQueries` construct saves each rollup as an Athena named query, written by the same builder
the command writes with:

```typescript
import { RollupQueries } from "@kensio/rainlytics/cdk";

new RollupQueries(this, "RainlyticsRollups", { table, workgroup });
```

Somebody in the console can then read what `rainlytics pageviews` counts, run it, and edit it into a
question of their own without reading this repository.

The saved copies cover the current month. There is no span to compute at deploy time, and dates
baked in then would be the dates of whoever last deployed and would change the template on every
deploy. They ask Athena what month it is:

```sql
WHERE year = date_format(current_date, '%Y')
  AND month = date_format(current_date, '%m')
```

### Narrowing a saved copy

Everything else a command takes is settled per rollup, by `requests`:

```typescript
new RollupQueries(this, "RainlyticsRollups", {
  table,
  workgroup,
  requests: {
    searches: { paths: ["/search/"], param: "term" },
  },
});
```

`searches` is why this is here. It reads one query-string parameter on one page. A saved copy left
to the defaults counts every query string on the distribution, while its own description tells the
reader to name the search page with `--path`. The parameter defaults to `q`. A site whose box calls
it something else gets a saved query that answers with an empty table.

Per rollup, and not one set of options across all five. `/search/` is the search page to `searches`
and one directory of a site to `pageviews`. A shared set would save `rainlytics-pageviews` as a
query counting the search page under a name promising the whole site. That is the same fault the
other way round. A rollup left out of `requests` takes the defaults a command starts from.

An entry takes what a rollup command takes, apart from `--last`. The range is always the current
month for the reason above, and the database comes from the table:

```typescript
requests: {
  "status-codes": { includeBots: true },
  searches: {
    host: "docs.example.com",
    paths: ["/search/"],
    param: "term",
    redirectStatuses: ["301", "302"],
  },
}
```

`paths` is the list `--path` collects when a command is given it more than once. A site with a
search box under two sections names both, and the saved copy counts them together.

`redirectStatuses` is `--redirect-status`, and it is where a site says what its own search page
answers with. The three a search counts by default are 302, 303 and 307, and
[searches](../searches/#which-statuses-count) covers why 301 and 308 are left out. A site whose
exact match answers 301 puts it here, and the saved query reads a `redirected` column that is right
for it.

An entry takes whatever `RollupRequest` carries, minus the range and the dataset. A field added to
the request arrives here on its own.

A fact that belongs to every question, such as the host of one site on a distribution serving
several, is a variable spread into each entry. Every key has to name a rollup being saved, and a
mistyped one fails at synthesis. The alternative is a deployed query still counting whatever it
counted before.

Each saved description says what its own copy covers. The console shows the narrowing to somebody
who has read no SQL:

```text
Count searches by the term somebody typed. What "rainlytics searches" runs.
Over the current month, on docs.example.com, under /search/, reading the "term"
parameter, counting 301 or 302 as redirected.
```

The statuses are named there only where a deployment chose its own. The three a search counts by
default are in the rollup's own description already, and a line repeating them on every copy says
nothing about that copy.

`--limit` is the one option left out of that line. A row count decides how much of the answer is
printed and leaves what was counted where it was. It sits on the last line of the SQL below.

## Writing a rollup of your own

The rollups above are assembled from parts the package exports, and a site with a question of its
own assembles another the same way. A rollup is a name, some help text and a function that writes
the SQL for one request:

```typescript
import {
  lastRange,
  qualifiedTableName,
  type Rollup,
  rollupRequest,
  rollupSql,
  rowsFor,
} from "@kensio/rainlytics";

const countries: Rollup = {
  name: "countries",
  summary: "Count views by country.",
  description: "Counts where readers were, most read from first.",
  isRanked: true,
  body: (request) =>
    [
      "SELECT c_country AS country, count(*) AS views",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, ["sc_content_type LIKE 'text/html%'"]),
      "  GROUP BY 1",
      "  ORDER BY 2 DESC, 1",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};

const sql = rollupSql(
  countries,
  rollupRequest({ range: lastRange("7d", new Date()) }),
);
```

`rowsFor` writes the whole `WHERE` clause. The partition predicate, the timestamp bounds, the
crawler filter and the `host` and `paths` the request narrowed to all come out of it, and its second
argument carries the conditions this one question adds. Writing that by hand puts a second copy of
[what a range costs](#--last-decides-what-the-question-costs) and of [the crawler
filter](#crawlers-are-most-of-the-traffic) in the site's own repository, and the copy is the one
that goes stale.

`rollupSql` hands back the text, and running it is the site's own Athena client. [Saving it in the
workgroup](#running-a-rollup-of-your-own) is the other way round, and the way that needs no client.

### Reading a query-string parameter

`decodedParameter` writes the expression that takes one parameter out of a record and decodes it. A
site counting the campaigns its inbound links name groups by that:

```typescript
import {
  decodedParameter,
  qualifiedTableName,
  type Rollup,
  rowsFor,
} from "@kensio/rainlytics";

const campaign = decodedParameter("utm_campaign");

const campaigns: Rollup = {
  name: "campaigns",
  summary: "Count views by the campaign that sent them.",
  description: "Counts the campaigns inbound links named, most sent first.",
  isRanked: true,
  body: (request) =>
    [
      `SELECT ${campaign} AS campaign, count(*) AS views`,
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, ["cs_uri_query <> '-'", `${campaign} <> ''`]),
      "  GROUP BY 1",
      "  ORDER BY 2 DESC, 1",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};
```

It names `cs_uri_stem` and `cs_uri_query` for itself. A record carries no whole URL, and those two
columns are joined back together with the `?` that was between them before CloudFront split them up.
(`'-'` is what CloudFront writes where a field was empty. The first condition drops the requests
that carried no query string.)

The value comes back decoded once, where [pageviews](#the-log-is-percent-encoded-twice) decodes a
column twice. `url_extract_parameter` decodes its own answer and one further pass finishes the job.
A second pass would decode a term holding a percent sequence twice, and `50%` typed into a search
box is the case. That rule is what the function carries. A hand-written
`url_decode(url_extract_parameter(...))` in the site's own repository carries the expression and
leaves the rule behind.

`decodedColumn` is the other half of this, for a question grouping by a whole column rather than by
one parameter. `pageviews` reads the path through it, and [`searches`](../searches/) reads its term
through `decodedParameter`.

### Naming the section a row came from

A question narrowed to several paths counts them together, and one term or one country then holds
rows from every one of them. `matchedPath` writes the prefix a row's address started with, as a
column the question selects and groups by:

```typescript
import {
  matchedPath,
  qualifiedTableName,
  type Rollup,
  rowsFor,
} from "@kensio/rainlytics";

const countriesBySection: Rollup = {
  name: "countries-by-section",
  summary: "Count views by country and section.",
  description: "Counts where readers were, section by section.",
  isRanked: true,
  body: (request) =>
    [
      `SELECT ${matchedPath(request)} AS section,`,
      "  c_country AS country, count(*) AS views",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(request, ["sc_content_type LIKE 'text/html%'"]),
      "  GROUP BY 1, 2",
      "  ORDER BY 3 DESC, 1, 2",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};
```

It is a `CASE` over the same prefix tests `rowsFor` filters with, branch by branch in the order the
request gave them. One definition of a prefix match covers both. A copy of the expression in a
site's own repository is a second definition, and the way those drift is a column that stops
agreeing with the filter beside it.

What the column holds follows from how many paths a run was given:

- **Several.** The first one the address starts with. Where two overlap, `/guides/` given alongside
  `/guides/advanced/` reports a row under the second as `/guides/`. Every row is then in exactly one
  section, and a reader adding the rows up counts each of them once.
- **One.** That path, as a literal. Every row counted started with it, and a `CASE` there asks a
  question with one answer.
- **None.** `CAST(NULL AS varchar)`. The whole distribution was counted and no prefix matched. An
  empty string would claim a prefix nobody asked for, and the cast gives the column a type in the
  result Athena hands back.

A rollup selects it however many paths it was given, and `--path` decides what comes back.
[`searches`](../searches/) is the built-in one that reads it, for a site with two search boxes.

The construct saves a site's rollup in the console beside the built-in ones:

```typescript
import { rollups } from "@kensio/rainlytics";
import { RollupQueries } from "@kensio/rainlytics/cdk";

new RollupQueries(this, "RainlyticsRollups", {
  table,
  workgroup,
  rollups: [...rollups, countries],
});
```

The saved copy covers the current month, as the built-in ones do. Its description says what it counts and
stops there, since there is no `rainlytics countries` to point a reader at. It takes an entry in
`requests` under its own name the way the built-in ones do.

A name is lowercase words joined by hyphens (`cache-hit-ratio`). It becomes a CDK logical id and an
Athena query name, and `assertRollupName` refuses anything else at synthesis.

### Running a rollup of your own

The saved copy is what gives a site's own question a command line:

```bash
rainlytics saved-query countries
```

`rainlytics saved-query` reads the queries saved in the workgroup and runs the one that matches, so
nothing on this side loads the site's code or asks for a build step. The name is the one Athena
lists, with or without the `rainlytics-` prefix, and a name matching nothing is answered with the
names that are saved there.

It takes `--output`, `--workgroup` and `--region`, and reports what the query scanned and what that
cost the way the built-in commands do. It takes no `--last` and no `--limit`. The SQL Athena holds
settled both when it was saved, which is why the range is the current month and the row count is the
one `requests` was given. The [command
line](../command-line/#running-a-query-saved-in-the-workgroup) page has the rest of it.

### Replacing one of the built-in questions

A site whose searches answer differently from the shipped `searches` writes its own version and
leaves the shipped one out of the list:

```typescript
import { rollups } from "@kensio/rainlytics";
import { RollupQueries } from "@kensio/rainlytics/cdk";

new RollupQueries(this, "RainlyticsRollups", {
  table,
  workgroup,
  rollups: [
    ...rollups.filter((rollup) => rollup.name !== "searches"),
    mySearches,
  ],
});
```

`rainlytics-searches` in the console is then the site's own question, and `rainlytics saved-query
searches` runs it. The `rainlytics searches` command still runs the shipped one, since its command
list is the questions the package ships. Two ways of asking, and the saved one is the site's.

Passing both is refused at synthesis, since one saved query cannot answer two questions:

```text
More than one rollup is called "searches", and each would be saved as
"rainlytics-searches". Where one of them replaces a built-in question, leave
the built-in out: rollups: [...rollups.filter((rollup) => rollup.name !==
"searches"), mySearches]
```

## Output, and what happens next

`--output json`, `csv` or `table`, defaulting to a table at a terminal and to JSON when piped. Every
value is a string, since every column in the log table is one.

```bash
rainlytics pageviews --last 7d --output csv > pages.csv
rainlytics referrers --last 7d | jq '.[0].referrer'
```

`--limit` takes the top rows of a ranked rollup, twenty by default. `cache-hit-ratio` answers with
one row and has nothing to limit.

Each of these reads Athena today, at the cost the [query](../query/) page describes. When the
scheduled rollups land, the same commands will read a precomputed summary off S3 and each
answer will cost a GET. The commands and their options stay where they are, so that swap is
invisible from out here.

## Anything else

[`rainlytics query`](../query/) takes SQL. These are the questions worth a name, and the log table
holds a great many more.

<!-- card
```bash
rainlytics pageviews --last 7d
rainlytics referrers --last 7d
rainlytics status-codes --last 7d --include-bots
rainlytics cache-hit-ratio --last 7d
```
-->
