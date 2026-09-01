# Rainlytics documentation

Start with [Getting started](getting-started/) to deploy Rainlytics and read your first pageview
report. [What Rainlytics is](https://rainlytics.com/guides/what-rainlytics-is/) explains the design
and cost model.

## Set up the pipeline

- [Getting started](getting-started/) covers installation, deployment and the first command.
- [Log bucket](log-bucket/) describes raw log storage and retention.
- [Log delivery](log-delivery/) connects a CloudFront distribution to the bucket.
- [Log table](log-table/) creates the projected Glue table that Athena reads.
- [Query workgroup](query-workgroup/) limits each Athena query and stores its results.
- [Summary schedule](summary-schedule/) precomputes common questions and calendar reports.

## Read analytics

- [Command line](command-line/) covers credentials, regions, output formats and exit codes.
- [Rollups](rollups/) defines the named analytics questions.
- [Searches](searches/) counts terms submitted to search pages.
- [Query](query/) runs ad-hoc SQL through Athena.
- [Rollup summaries](summaries/) documents the stored summary format.
- [Calendar reports](reports/) documents reports for closed calendar periods.
- [Counting visitors](visitors/) explains visitor identity and the required salt.

## Add browser measurements

- [Beacon path](beacon-path/) adds the first-party collection route to CloudFront.
- [Browser beacon](beacon/) reports SPA routes and custom events.
- [Beacon events](beacon-events/) counts custom events and limits repeated identical events.
- [Web Vitals](web-vitals/) reports p75 performance measurements.
- [JavaScript errors](javascript-errors/) groups errors by page and message.
- [Collection-path abuse](abuse/) explains the cost and filtering limits of an open endpoint.

Every topic page lives in its own directory as `README.md`. The website copies these pages into its
Starlight content tree.
