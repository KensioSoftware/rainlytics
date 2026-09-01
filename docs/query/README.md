# Query

`rainlytics query` runs SQL through the Rainlytics Athena workgroup and prints every result row.

```bash
rainlytics query "SELECT cs_uri_stem, count(*) AS views
  FROM cloudfront_logs
  WHERE year = '2026' AND month = '09' AND day = '01'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5"
```

Quote the SQL as one shell argument.

## Select the deployed resources

The defaults use database `rainlytics`, table `cloudfront_logs` and workgroup `rainlytics`.

```bash
rainlytics query "SELECT count(*) FROM cloudfront_logs" \
  --region us-east-1 \
  --database rainlytics \
  --workgroup rainlytics
```

Credentials and default region come from the AWS SDK credential chain. The selected region must
contain the workgroup and Glue table. Keep the table in the log bucket's region to avoid
cross-region S3 transfer on every query.

## Always restrict partitions

Athena charges by bytes scanned. For an hourly table, restrict `distributionid`, `year`, `month`,
`day` and `hour` where possible.

```sql
SELECT count(*)
FROM cloudfront_logs
WHERE distributionid = 'E1EXAMPLE1234'
  AND year = '2026'
  AND month = '09'
  AND day = '01'
  AND hour IN ('13', '14')
```

A condition on `timestamp_ms`, path, status or another normal column filters rows after Athena has
read the partition. Add timestamp bounds for exact edges, but keep the partition conditions.

The workgroup stops a query that passes its byte limit. Athena charges for bytes read before a
cancelled query stops. Narrow the partitions or raise `bytesScannedCutoff` when a legitimate report
needs more data.

## Read CloudFront values

Every column is stored as text. Cast numbers and timestamps in SQL. CloudFront uses `-` for missing
values and percent-encodes logged fields.

```sql
SELECT
  from_unixtime(cast(timestamp_ms AS bigint) / 1000) AS requested_at,
  cast(sc_status AS integer) AS status,
  nullif(cs_referer, '-') AS referrer,
  url_decode(cs_uri_stem) AS path
FROM cloudfront_logs
WHERE year = '2026' AND month = '09' AND day = '01'
```

See [Log table](../log-table/#column-names-and-values) for field-name mapping.

## Cost and output

After each query, standard error reports the query ID, workgroup, region, bytes scanned, duration
and estimated cost. Result rows go to standard output.

```bash
rainlytics query "SELECT c_country, count(*) AS views
  FROM cloudfront_logs
  WHERE year = '2026' AND month = '09'
  GROUP BY 1" | jq '.[0]'
```

Use `--output json`, `csv` or `table`. Athena returns results in pages, and Rainlytics fetches every
page. Add a SQL `LIMIT` when the complete result is too large to be useful.

## Permissions

The caller needs Athena access to the workgroup, Glue reads for the catalog and table, S3 reads on
the log bucket, and S3 reads and writes on the results bucket.

Grant these permissions from CDK:

```typescript
workgroup.grantQuerying(role, table);
```

<!-- card
```bash
rainlytics query "SELECT count(*) FROM cloudfront_logs
  WHERE year = '2026' AND month = '09' AND day = '01'"
```
-->
