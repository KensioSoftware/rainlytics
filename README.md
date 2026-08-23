# Rainlytics

Self-hosted web analytics for AWS sites, built on CloudFront logs.

[rainlytics.dev](https://rainlytics.dev "Rainlytics documentation")

Rainlytics runs the whole analytics pipeline inside your own AWS account. Most
of what it reports is derived from the CloudFront access logs your
distribution already writes. A measured page downloads no analytics
JavaScript, opens no extra connection, and resolves no extra hostname.

An optional beacon covers what an access log cannot see accurately, such as
route changes in a single-page app, Core Web Vitals, custom events and
JavaScript errors. It is bundled into the site's own JavaScript and reports
back through the site's own domain (no second host, no separate script tag).

Everything runs on usage-priced AWS services, batched and precomputed on a
schedule rather than processed per request. Nothing in the pipeline is always
on, and a low-traffic site should cost cents a month.

## Status

Early. The architecture is settled and most of the code is still to be
written.

## License

Apache 2.0. See [LICENSE](LICENSE).

Rainlytics is an independent open-source project with no affiliation with,
sponsorship from, or endorsement by Amazon or AWS. The name is a nod to
rainforests.
