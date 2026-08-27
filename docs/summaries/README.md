# Rollup summaries

The precomputed answers a scheduled job writes to S3. Reading one costs a GET.

Every named question runs Athena today, and Athena prices per query. Asking the same question twice
pays twice. A summary is one question answered over one window, written once and read as many times
as anybody looks.

This page is the schema. Nothing computes or reads one yet.
[#55](https://github.com/KensioSoftware/rainlytics/issues/55) writes them on a schedule and
[#56](https://github.com/KensioSoftware/rainlytics/issues/56) makes the commands read them.

## The document

```json
{
  "schemaVersion": 1,
  "question": {
    "name": "pageviews",
    "includeBots": false,
    "limit": 100,
    "param": "q"
  },
  "window": {
    "granularity": "daily",
    "from": "2026-08-27T00:00:00.000Z",
    "until": "2026-08-28T00:00:00.000Z"
  },
  "computedAt": "2026-08-28T00:15:04.212Z",
  "columns": ["path", "views"],
  "rows": [
    { "path": "/", "views": "412" },
    { "path": "/liju/", "views": "208" }
  ],
  "visitors": { "distinct": 317, "additive": false }
}
```

`RollupSummary` in the package root is that document as a type:

```typescript
import { type RollupSummary, summaryKey } from "@kensio/rainlytics";
```

**`question`** is the rollup's name and the narrowing it ran under, being everything a
`rainlytics pageviews` run takes apart from `--last`. It is here because a summary counting one
section of a site answers a narrower question than one counting the whole of it. A reader compares
this against what somebody asked for and can see when the two differ. The type comes from
`RollupRequest` itself. A filter added to the commands is then a filter recorded here, without
anybody remembering to add it.

The SQL stays out. A summary that carried the query would go stale against the package that reads
it, and a reader holding SQL from last year cannot tell which of the two is right. A summary that
carried only rows would leave the reader guessing what they counted.

**`columns`** is stated in the document and never read off the rows. A summary that found nothing
still names what it was looking for. The CSV output follows the same rule, because an empty answer
needs a header as much as a full one does.

**`rows`** hold text, because every column in the log table is text and Athena hands every value
back as text. A value the query left empty is `null`.

**`computedAt`** is when the job ran. Every instant in the document is ISO 8601 text, and none of
them is a `Date`. This describes a document on S3, and `JSON.parse` hands text back. A field typed
as a date is a string at run time in every reader that forgot to convert it.

## Where a summary lives

```text
summaries/v1/pageviews/daily/2026-08-27.json
summaries/v1/pageviews/hourly/2026-08-27T14Z.json
```

`summaryKey` builds it from the question and the window alone:

```typescript
import { summaryKey } from "@kensio/rainlytics";

const key = summaryKey(question, { granularity: "daily", at: new Date() });
```

The instant can be any moment inside the window. The builder truncates it, the way `partitionPrefix`
addresses the partition holding an instant. A job running fifteen minutes after the hour hands over
the time it is now.

A job re-run writes the same key and overwrites what was there. That is what makes a bug in a rollup
a re-run and never an incident, and it is what lets a window be recomputed for the records that
arrived after the first run of it.

Only the question's name reaches the key. Two narrowings of one question are two questions and take
two names, the way `RollupQueries` [saves one named query per rollup
name](../rollups/#the-same-sql-saved-in-the-console). A site that wants pageviews for one section as
well as for the whole of it [writes a rollup of its own](../rollups/#writing-a-rollup-of-your-own)
and gives it a name. Two questions scheduled under one name would overwrite each other, and #55 can
refuse that pair at synthesis the way `RollupQueries` refuses two rollups saved under one name. The
narrowing in the document is what catches it afterwards.

Keys sort into the order the windows happened. The newest summary is the last one in a listing of
the prefix above it. No reader parses a key. The dates in it are UTC, and the document carries the
span in full.

## Hours and days

Rainlytics stores two windows. An hour is what a reader wants when the question is about this
morning, and it is the unit a local day is put together from. A day is what most questions are
actually about, and it holds a month of pageviews to thirty GETs where hours would take seven
hundred and twenty.

Each is computed from raw. A day is its own query over twenty-four partitions and never the sum of
twenty-four hourly summaries. Three things break when summaries are added together:

- **A ranked answer is truncated.** The top twenty paths of two hours are a different list from the
  top twenty paths of the two hours together. A path that came twenty-first in every hour of a day
  can outrank one that led a single hour, and the stored rows have already dropped it.
- **A visitor is a different person tomorrow.** See [Counting
  visitors](#counting-visitors-and-what-cannot-be-added) below.
- **Records arrive late.** A window recomputed for them is one query. A composed answer would need
  every window under it recomputed first, and would go on being wrong until they all had been.

Nothing coarser is stored. A weekly or monthly object is a number a reader cannot check against the
days inside it, and a visitor count over one has no meaning at all. Every window Rainlytics stores is
one that every measure in a summary is true over.

The cost of storing both is one Athena query per window per question. Athena bills a ten million byte
minimum whatever a query reads, and 25 queries a day comes to about four cents a month for one
question. Five questions on both cadences is 45,625 objects a year, about $0.23 of PUTs and a
rounding error of storage. The [query](../query/) page has where the per-query figure comes from.

## Every window is UTC

The partitions underneath are UTC, and every window stored here is UTC. A summary stored for one
person's local day is the wrong day for the next person to ask, and the bucket has one layout for
everybody.

The conversion to somebody's own day happens in the reader, at the moment an answer is printed. That
is where the person is, and it is the only place that knows which day they meant.

A reader on a whole-hour offset assembles a local day from 24 hourly summaries. That is the second
reason hourly windows are stored. The exceptions are worth knowing:

- A zone offset by 30 or 45 minutes (India at UTC+05:30, Nepal at UTC+05:45) has no local day that
  hourly windows can be cut to. A reader there wanting exact local days queries Athena.
- A local day across a daylight-saving change is 23 or 25 hours long. The count of summaries changes
  with it, and the arithmetic is the reader's.
- A ranked answer assembled from hours carries the truncation described above. Totals add. Ranked
  lists are approximate, and a reader that wants an exact one asks for a stored window.

Storing local days instead would multiply the objects by the number of zones anybody might ask for,
and would make an old summary change meaning when a country next moves its clocks.

## Never computed, and no traffic

A reader fetching a summary meets three answers.

- **A document with rows** is the answer.
- **A document with no rows** is a window that saw no traffic. The job writes one whenever a query
  comes back empty, and that is a requirement on the job rather than an accident of it.
- **No object at all** is a window nobody has computed. The package calls it `neverComputed`, and a
  command printing what it found prints that. What happened in that window is still an open
  question.

```typescript
import { neverComputed, type SummaryLookup } from "@kensio/rainlytics";

// `readSummary` is whatever fetches the object and parses it.
const found: SummaryLookup = await readSummary(key);

if (found === neverComputed) {
  // A summary was never written for this window.
}
```

The middle case is what separates a quiet Sunday from a job that failed on Sunday night. Both are
the same 404 without it.

## Versioning

The version is a single integer. It appears in the key and again in the document.

In the key, to let a command ask for the shape it can read. A command released against version 2
looks under `summaries/v2/` and gets a 404 while nothing has written one. Every reader already
handles a 404. A document whose fields have moved is a case each of them would need to grow.

In the document, because an object separated from its key still has to say what it is. A summary
downloaded, piped through `jq` or copied into a bucket of somebody's own carries no prefix with it.

It changes when a field changes meaning or leaves. A field added and left optional keeps it where it
is. A reader that has never heard of that field ignores it, and one that has can tell absent from
present. `visitors` is that case, and it arrives without a version bump.

A version bump writes a new prefix and leaves the old one where it is. Both can be written at once
while a deployment catches up, and whatever lifecycle rule covers the bucket removes the old prefix
in its own time.

## Counting visitors, and what cannot be added

Rainlytics counts unique visitors with a daily-rotating hash of the viewer address
([#53](https://github.com/KensioSoftware/rainlytics/issues/53)). The salt changes every day, so one
person carries one identifier today and a different one tomorrow.

A day of them counts. Two days added together count everybody who came back twice over, and a month
of them is a figure about nothing. Somebody reading thirty daily summaries with `jq` is one line away
from that figure, and a bare number would let the line through in silence.

So the count is an object:

```json
"visitors": { "distinct": 317, "additive": false }
```

`VisitorCount` is an object holding a number. Summing a column of objects fails to compile, and
`additive` says the same thing to somebody reading the JSON who never sees the type. Both halves say
it because the two readers are different people.

The field is absent until [#74](https://github.com/KensioSoftware/rainlytics/issues/74) computes an
identifier, and absent from every question that counts something else. `{ "distinct": 0, "additive":
false }` is a different answer, being a window that nobody visited.

A count over a week or a month is a query over raw, and only where a salt older than a day can still
be reached. #74 decides where the salt lives.

## What is still to come

[#55](https://github.com/KensioSoftware/rainlytics/issues/55) is the construct that computes these on
a schedule, on a lag long enough for CloudFront to have delivered the hour. Delivery took under six
minutes across 200,074 records in
[#9](https://github.com/KensioSoftware/rainlytics/issues/9), and a run that treated an hour as closed
the moment it ended would drop the tail of every one of them.
[#56](https://github.com/KensioSoftware/rainlytics/issues/56) makes `rainlytics pageviews --last 7d`
read a summary, and says what a command does with a range no stored window covers.

Until both land, the [rollup commands](../rollups/) query Athena and report what that cost.

<!-- card
```json
{
  "question": { "name": "pageviews", "includeBots": false },
  "window": { "granularity": "daily", "from": "2026-08-27T00:00:00.000Z" },
  "rows": [{ "path": "/", "views": "412" }],
  "visitors": { "distinct": 317, "additive": false }
}
```
-->
