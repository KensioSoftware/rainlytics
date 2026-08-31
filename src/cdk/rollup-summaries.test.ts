import {
  assertArrayIncludes,
  assertArrayNotIncludes,
  assertIdentical,
  assertObjectEquals,
  assertObjectMatches,
  assertStringIncludes,
  assertUndefined,
} from "@kensio/smartass";
import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { gzipSync } from "node:zlib";

import { faker } from "@faker-js/faker";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import {
  App,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
} from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { deployStacks, simStartedAt } from "#test/simulated-deployment.js";

import { summaryEnvironment } from "../functions/summary-deployment.js";
import { logFieldNamesWithoutAddress } from "../log-fields.js";
import { partitionPrefix } from "../partitions.js";
import { pageviews } from "../rollup-questions.js";
import type { RollupSummary } from "../rollup-summaries.js";
import { summarySchemaVersion } from "../rollup-summaries.js";
import {
  defaultRedirectStatuses,
  windowPlaceholder,
  withoutVisitorCount,
} from "../rollups.js";
import {
  defaultVisitorSaltParameter,
  visitorSaltPlaceholder,
} from "../visitor-identity.js";
import { CloudFrontLogDelivery } from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable } from "./log-table.js";
import { QueryWorkgroup } from "./query-workgroup.js";
import { RollupSummaries } from "./rollup-summaries.js";
import type { RollupSummariesProps } from "./summary-configuration.js";

describe("computing rollup summaries on a schedule", () => {
  /**
   * The hour the traffic in these cases happened in.
   *
   * The simulation starts at 09:00 and the schedules fire at fifteen minutes
   * past, so the newest closed hour a run meets is the one before it.
   */
  const theClosedHour = new Date("2026-08-23T08:00:00.000Z");

  /** A whole deployment in a simulated account, computing one question. */
  const deployAnalytics = async (
    over: Partial<RollupSummariesProps> = {},
    inStack: (stack: Stack) => Partial<RollupSummariesProps> = () => ({}),
    site: {
      /** What the delivery asks CloudFront for, defaulting to the whole set. */
      readonly fields?: readonly string[];

      /** Whether the account holds a visitor salt at all. */
      readonly salt?: boolean;
    } = {},
  ) => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
    const summariesBucketName = `rainlytics-summaries-${faker.string.uuid()}`;

    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "AnalyticsStack", {
          env: { account, region: "us-east-1" },
        });
        const logs = new LogBucket(stack, "RainlyticsLogs", {
          bucketName: logBucketName,
        });
        const distribution = new Distribution(stack, "Site", {
          defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
        });
        new CfnOutput(stack, "DistributionId", {
          value: distribution.distributionId,
        });
        const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
          distributionId: distribution.distributionId,
          logBucket: logs.bucket,
          ...(site.fields === undefined ? {} : { fields: site.fields }),
        });
        const table = new LogTable(stack, "RainlyticsTable", {
          deliveries: [delivery],
        });
        const workgroup = new QueryWorkgroup(stack, "RainlyticsQueries", {
          resultsBucketName: `rainlytics-results-${faker.string.uuid()}`,
        });

        new RollupSummaries(stack, "RainlyticsSummaries", {
          table,
          workgroup,
          rollups: [pageviews],
          granularities: ["hourly"],
          summariesBucketName,
          removalPolicy: RemovalPolicy.DESTROY,
          ...inStack(stack),
          ...over,
        });
      },
    );

    await simAws.region("us-east-1").account().athena().engine().enable();

    // The salt secret, put where a site's operator puts it. Nothing in the
    // stack creates it, because CloudFormation writes no SecureString and a
    // secret in a template is not one. `docs/visitors/` has the command. A
    // case about a deployment counting no visitors leaves it out, which is
    // the account a site running without one actually has.
    if (site.salt !== false) {
      await simAws
        .region("us-east-1")
        .account()
        .ssm()
        .putParameter({
          input: {
            Name: defaultVisitorSaltParameter,
            Type: "SecureString",
            Value: faker.string.hexadecimal({ length: 64, prefix: "" }),
          },
        });
    }

    return {
      simAws,
      logBucketName,
      summariesBucketName,
      distributionId: String(
        stacks.get("AnalyticsStack")?.output("DistributionId"),
      ),
    };
  };

  type Deployed = Awaited<ReturnType<typeof deployAnalytics>>;

  /**
   * One record, with everything a rollup reads set to something sensible.
   *
   * Every record gets an address of its own. A case that says nothing about
   * visitors then counts one per record, and a case that cares who came back
   * hands `c-ip` in.
   */
  const aRecord = (
    at: Date,
    over: Readonly<Record<string, string>> = {},
  ): Readonly<Record<string, string>> => ({
    "timestamp(ms)": String(at.getTime()),
    "x-host-header": "www.example.com",
    "cs-method": "GET",
    "cs-uri-stem": "/",
    "cs-uri-query": "-",
    "sc-status": "200",
    "sc-content-type": "text/html",
    "cs(Referer)": "-",
    "cs(User-Agent)": "Mozilla/5.0%20(Macintosh)",
    "x-edge-result-type": "Hit",
    "c-country": "GB",
    "c-ip": faker.internet.ipv4(),
    ...over,
  });

  /** One delivered object holding these records. */
  const putDelivered = async (
    deployed: Deployed,
    at: Date,
    records: readonly Readonly<Record<string, string>>[],
  ): Promise<void> => {
    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key: `rainlytics/${partitionPrefix({
            distributionId: deployed.distributionId,
            at,
          })}/${String(at.getTime())}.gz`,
          Body: gzipSync(
            records.map((record) => JSON.stringify(record)).join("\n"),
          ),
        },
      });
  };

  /** Whatever is under one key in the summaries bucket. */
  const summaryAt = async (
    deployed: Deployed,
    key: string,
  ): Promise<RollupSummary | undefined> => {
    const found = await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .getObject({
        input: { Bucket: deployed.summariesBucketName, Key: key },
      })
      .catch(() => undefined);

    return found === undefined
      ? undefined
      : (JSON.parse(
          await text(found.Body as unknown as Readable),
        ) as RollupSummary);
  };

  /** The rows one summary holds, or nothing where none was written. */
  const rowsIn = async (
    deployed: Deployed,
    key: string,
  ): Promise<RollupSummary["rows"] | undefined> => {
    const summary = await summaryAt(deployed, key);

    return summary?.rows;
  };

  /*
   * The keys the summaries land under, written out here from
   * `docs/summaries/` rather than built with `summaryKey`. A test that asked
   * the code where it had put something would pass whatever the code decided,
   * and the layout is a promise to whatever reads the bucket next.
   */
  const closedHourKey = "summaries/v1/pageviews/hourly/2026-08-23T08Z.json";
  const hourBeforeKey = "summaries/v1/pageviews/hourly/2026-08-23T07Z.json";
  const closedDayKey = "summaries/v1/pageviews/daily/2026-08-23.json";

  it("writes the closed hour to the bucket when the schedule fires", async () => {
    // Given an hour of traffic holding two views of the home page and one of
    // a second page, delivered under the hour that has since closed.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, theClosedHour, [
      aRecord(theClosedHour),
      aRecord(theClosedHour),
      aRecord(theClosedHour, { "cs-uri-stem": "/grammar/" }),
    ]);

    // When the clock reaches the first firing of the hourly schedule.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the hour is in the bucket, under the key the schema builds, with
    // the rows the question answered.
    const summary = await summaryAt(deployed, closedHourKey);

    assertObjectEquals(summary?.window, {
      granularity: "hourly",
      from: "2026-08-23T08:00:00.000Z",
      until: "2026-08-23T09:00:00.000Z",
    });
    assertObjectEquals(summary.columns, ["path", "views"]);
    assertObjectEquals(summary.rows, [
      { path: "/", views: "2" },
      { path: "/grammar/", views: "1" },
    ]);
  });

  it("records the question the summary answers", async () => {
    // Given an hour of traffic under a question narrowed to one host.
    const deployed = await deployAnalytics({
      requests: { pageviews: { host: "www.example.com", limit: 5 } },
    });
    await putDelivered(deployed, theClosedHour, [aRecord(theClosedHour)]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the document says what it counted, so a reader asking a wider
    // question can see that this answer is a narrower one.
    const summary = await summaryAt(deployed, closedHourKey);

    assertIdentical(summary?.schemaVersion, summarySchemaVersion);
    assertObjectEquals(summary.question, {
      name: "pageviews",
      host: "www.example.com",
      includeBots: false,
      limit: 5,
      param: "q",
      redirectStatuses: defaultRedirectStatuses,
    });
    assertIdentical(summary.computedAt, "2026-08-23T09:15:00.000Z");
  });

  it("writes an empty answer for a window that saw no traffic", async () => {
    // Given traffic in the hour before the one that has just closed, and
    // none in the closed hour itself.
    const deployed = await deployAnalytics();
    const hourBefore = new Date("2026-08-23T07:30:00.000Z");
    await putDelivered(deployed, hourBefore, [aRecord(hourBefore)]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then both hours have a summary, and the quiet one holds no rows. A
    // window nobody computed is no object at all, and a reader has to be able
    // to tell the two apart.
    assertObjectEquals(await rowsIn(deployed, hourBeforeKey), [
      { path: "/", views: "1" },
    ]);

    const quiet = await summaryAt(deployed, closedHourKey);

    assertObjectEquals(quiet?.rows, []);
    assertObjectEquals(quiet.columns, ["path", "views"]);
  });

  it("picks up a record that arrived after its window was computed", async () => {
    // Given an hour computed with two of its records delivered.
    const deployed = await deployAnalytics();
    await putDelivered(deployed, theClosedHour, [
      aRecord(theClosedHour),
      aRecord(theClosedHour),
    ]);
    await deployed.simAws.clock().advanceBy({ minutes: 16 });
    assertObjectEquals(await rowsIn(deployed, closedHourKey), [
      { path: "/", views: "2" },
    ]);

    // When a third record for that hour is delivered late, and the next run
    // happens.
    await putDelivered(deployed, new Date("2026-08-23T08:45:00.000Z"), [
      aRecord(theClosedHour),
    ]);
    await deployed.simAws.clock().advanceBy({ hours: 1 });

    // Then the hour is recomputed and counts it. A run that only ever wrote
    // the window that had just closed would have left this record out for as
    // long as the summary lived.
    assertObjectEquals(await rowsIn(deployed, closedHourKey), [
      { path: "/", views: "3" },
    ]);
  });

  it("computes the day that closed on the daily cadence", async () => {
    // Given a day of traffic, and a deployment computing days.
    const deployed = await deployAnalytics({ granularities: ["daily"] });
    await putDelivered(deployed, theClosedHour, [
      aRecord(theClosedHour),
      aRecord(new Date("2026-08-23T21:00:00.000Z"), {
        "cs-uri-stem": "/grammar/",
      }),
    ]);

    // When the clock reaches the first firing after midnight UTC.
    await deployed.simAws.clock().advanceBy({ hours: 15, minutes: 16 });

    // Then the day is in the bucket, counted from raw rather than added up
    // out of its hours.
    const summary = await summaryAt(deployed, closedDayKey);

    assertObjectEquals(summary?.window, {
      granularity: "daily",
      from: "2026-08-23T00:00:00.000Z",
      until: "2026-08-24T00:00:00.000Z",
    });
    assertObjectEquals(summary.rows, [
      { path: "/", views: "1" },
      { path: "/grammar/", views: "1" },
    ]);
  });

  it("computes one window on a lag a site chose", async () => {
    // Given a site that watched its own delivery, wants a shorter lag, and
    // is content to compute each hour once.
    const deployed = await deployAnalytics({
      lag: Duration.minutes(5),
      recomputedWindows: 1,
      timeout: Duration.minutes(2),
      logRetention: RetentionDays.ONE_WEEK,
    });
    const hourBefore = new Date("2026-08-23T07:30:00.000Z");

    await putDelivered(deployed, theClosedHour, [aRecord(theClosedHour)]);
    await putDelivered(deployed, hourBefore, [aRecord(hourBefore)]);

    // When the clock reaches five minutes past the hour.
    await deployed.simAws.clock().advanceBy({ minutes: 6 });

    // Then the hour that closed is there and the one before it was left
    // alone. No object at all is a window nobody computed, and it reads
    // differently from a window that saw no traffic.
    assertObjectEquals(await rowsIn(deployed, closedHourKey), [
      { path: "/", views: "1" },
    ]);
    assertUndefined(await summaryAt(deployed, hourBeforeKey));
  });

  it("writes into a bucket the site brought with it", async () => {
    // Given a site that keeps its summaries in a bucket of its own, so that
    // something outside this stack can be given read access to them.
    const ownBucketName = `mine-${faker.string.uuid()}`;
    const deployed = await deployAnalytics({}, (stack) => ({
      summariesBucket: new Bucket(stack, "Mine", {
        bucketName: ownBucketName,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    }));

    await putDelivered(deployed, theClosedHour, [aRecord(theClosedHour)]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the summary lands in that bucket, under the same key.
    const found = await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .getObject({ input: { Bucket: ownBucketName, Key: closedHourKey } });

    assertObjectMatches(
      JSON.parse(await text(found.Body as unknown as Readable)),
      {
        rows: [{ path: "/", views: "1" }],
      },
    );
  });

  it("counts the visitors the closed hour saw", async () => {
    // Given an hour holding two views from one address and one from another.
    // Both are written out from the documentation ranges rather than drawn,
    // because the number this asserts is how many of them there are.
    const returning = "203.0.113.7";
    const passingThrough = "198.51.100.24";
    const deployed = await deployAnalytics();
    await putDelivered(deployed, theClosedHour, [
      aRecord(theClosedHour, { "c-ip": returning }),
      aRecord(theClosedHour, { "c-ip": returning }),
      aRecord(theClosedHour, { "c-ip": passingThrough }),
    ]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the summary carries three views and two visitors. The gap between
    // the two numbers is the address that came back, counted once.
    const summary = await summaryAt(deployed, closedHourKey);

    assertObjectEquals(summary?.rows, [{ path: "/", views: "3" }]);
    assertObjectEquals(summary.visitors, { distinct: 2, additive: false });
  });

  it("asks Athena nothing where the salt parameter is missing", async () => {
    // Given a deployment naming a parameter nobody created, and an hour of
    // traffic waiting to be counted.
    const parameter = `/mine/${faker.string.uuid()}`;
    const deployed = await deployAnalytics({ visitorSaltParameter: parameter });
    const account = deployed.simAws.region("us-east-1").account();
    await putDelivered(deployed, theClosedHour, [aRecord(theClosedHour)]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the run failed naming the parameter, having asked Athena nothing.
    // A run that queried first would have paid for a window it then refused
    // to write. Scheduler keeps a failed invocation to itself, and the
    // simulation's record of it stands in for the log group.
    const [failure] = account.scheduler().deliveryFailures;

    assertStringIncludes(failure?.message, parameter);
    assertObjectEquals(account.athena().queryExecutions(), []);
    assertUndefined(await summaryAt(deployed, closedHourKey));
  });

  it("summarises an hour with no salt where the address is undelivered", async () => {
    // Given a site delivering the field set that holds no personal data, in
    // an account where nobody has ever created a visitor salt.
    const deployed = await deployAnalytics(
      { rollups: [withoutVisitorCount(pageviews)] },
      () => ({}),
      { fields: logFieldNamesWithoutAddress, salt: false },
    );
    const { "c-ip": _address, ...asDelivered } = aRecord(theClosedHour);
    await putDelivered(deployed, theClosedHour, [asDelivered, asDelivered]);

    // When the schedule fires.
    await deployed.simAws.clock().advanceBy({ minutes: 16 });

    // Then the hour is summarised as usual and carries no visitor count. A
    // reader sees the field absent rather than a zero, and the run needed no
    // parameter to get there.
    const summary = await summaryAt(deployed, closedHourKey);

    assertObjectEquals(summary?.rows, [{ path: "/", views: "2" }]);
    assertUndefined(summary.visitors);
  });

  it("hands the visitor count to the schedule without the salt", async () => {
    // Given a deployment of the question as Rainlytics ships it, which counts
    // visitors.
    const deployed = await deployAnalytics();

    // When the schedule's target input is read back.
    const schedule = await deployed.simAws
      .region("us-east-1")
      .account()
      .scheduler()
      .getSchedule({ input: { Name: "rainlytics-pageviews-hourly" } });
    const input = String(schedule.Target?.Input);

    // Then it carries the count and neither the window nor the salt. Both
    // arrive when the run happens, which is what keeps a salt out of the
    // schedule and out of the CloudFormation template holding it.
    assertStringIncludes(input, "visitorSql");
    assertStringIncludes(input, windowPlaceholder);
    assertStringIncludes(input, visitorSaltPlaceholder);
  });

  it("keeps the report schedule outside the rollup naming scheme", async () => {
    // Given a daily rollup called reports, which occupies the schedule name
    // a report schedule would take without its separator.
    const deployed = await deployAnalytics({
      rollups: [{ ...pageviews, name: "reports" }],
      granularities: ["daily"],
    });

    // When the schedules in the default group are listed.
    const listed = await deployed.simAws
      .region("us-east-1")
      .account()
      .scheduler()
      .listSchedules({ input: {} });
    const names = (listed.Schedules ?? []).map((schedule) => schedule.Name);

    // Then the rollup and report schedules have distinct names.
    assertArrayIncludes(names, "rainlytics-reports-daily");
    assertArrayIncludes(names, "rainlytics-_reports-daily");
  });

  it("tells the job which parameter the salt is in", async () => {
    // Given a site that keeps its secret under a name of its own.
    const parameter = `/mine/${faker.string.uuid()}`;
    const deployed = await deployAnalytics({ visitorSaltParameter: parameter });
    const lambda = deployed.simAws.region("us-east-1").account().lambda();
    const functions = await lambda.listFunctions({ input: {} });

    // Then the deployed function reads that one. A deployment that named
    // none would count visitors under a salt it invented.
    const found = await lambda.getFunction({
      input: { FunctionName: String(functions.Functions[0]?.FunctionName) },
    });

    assertObjectMatches(found.Configuration.Environment?.Variables, {
      [summaryEnvironment.visitorSaltParameter]: parameter,
    });
  });

  it("names the default parameter where a site chose none", async () => {
    // Given a deployment that said nothing about where its secret lives.
    const deployed = await deployAnalytics();
    const lambda = deployed.simAws.region("us-east-1").account().lambda();
    const functions = await lambda.listFunctions({ input: {} });

    // Then it reads the one `docs/visitors/` tells an operator to create.
    const found = await lambda.getFunction({
      input: { FunctionName: String(functions.Functions[0]?.FunctionName) },
    });

    assertObjectMatches(found.Configuration.Environment?.Variables, {
      [summaryEnvironment.visitorSaltParameter]: defaultVisitorSaltParameter,
    });
  });

  it("starts from the instant the simulation does", () => {
    // Given nothing but the fixed clock these cases count their hours from.
    // Then the windows written out above are the ones a run would meet.
    assertIdentical(simStartedAt.toISOString(), "2026-08-23T09:00:00.000Z");
  });

  describe("what an identity granted reading summaries can reach", () => {
    /**
     * A deployment in one stack, with a role handed the read grant.
     *
     * Synthesised rather than deployed. IAM is the part of this a simulated
     * account cannot prove, for the reason `summary-permissions.test.ts`
     * gives, so this case reads the policy the grant wrote.
     */
    const grantedTo = (
      summariesBucket: (stack: Stack) => Bucket | undefined = () => undefined,
    ): Stack => {
      const stack = new Stack(new App(), "AnalyticsStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      const logs = new LogBucket(stack, "RainlyticsLogs", {
        bucketName: `rainlytics-logs-${faker.string.uuid()}`,
      });
      const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
        distributionId: "E1EXAMPLE1234",
        logBucket: logs.bucket,
      });
      const passed = summariesBucket(stack);
      const summaries = new RollupSummaries(stack, "RainlyticsSummaries", {
        table: new LogTable(stack, "RainlyticsTable", {
          deliveries: [delivery],
        }),
        workgroup: new QueryWorkgroup(stack, "RainlyticsQueries"),
        rollups: [pageviews],
        granularities: ["hourly"],
        ...(passed === undefined ? {} : { summariesBucket: passed }),
      });

      summaries.grantReadingSummaries(
        new Role(stack, "Reader", {
          assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
        }),
      );

      return stack;
    };

    /**
     * Every action the reader's own policy allows.
     *
     * The reader's alone. The stack also holds the scheduled job, whose role
     * reads and writes far more than a reader does, and a case that gathered
     * both would pass on the job's permissions.
     */
    const allowed = (stack: Stack): readonly string[] => {
      const policies = Template.fromStack(stack).findResources(
        "AWS::IAM::Policy",
        { Properties: { Roles: [{ Ref: Match.stringLikeRegexp("^Reader") }] } },
      ) as Record<
        string,
        {
          Properties: {
            PolicyDocument: { Statement: { Action: string | string[] }[] };
          };
        }
      >;

      return Object.values(policies).flatMap((policy) =>
        policy.Properties.PolicyDocument.Statement.flatMap((statement) =>
          [statement.Action].flat(),
        ),
      );
    };

    it("reads the objects and nothing else", () => {
      // Given a role a site handed the read grant.
      const stack = grantedTo();

      // When the actions the grant wrote are read back.
      const actions = allowed(stack);

      // Then it can fetch a summary. Every key a reader wants is built from
      // the question and the window, so this is the whole of the read path.
      assertArrayIncludes(actions, "s3:GetObject");
      // And it cannot write one. A reader that could put an object could
      // answer a question with a figure nothing computed.
      assertArrayNotIncludes(actions, "s3:PutObject");
    });

    it("decrypts a summaries bucket a site keeps under its own key", () => {
      // Given a site passing a bucket encrypted with a customer key rather
      // than letting the construct create one under S3-managed encryption.
      const stack = grantedTo(
        (inStack) =>
          new Bucket(inStack, "OwnSummaries", {
            encryption: BucketEncryption.KMS,
            encryptionKey: new Key(inStack, "SummaryKey"),
          }),
      );

      // Then the reader can decrypt what it reads. S3 answers a GetObject
      // under a key the caller cannot use with an AccessDenied from KMS.
      assertArrayIncludes(allowed(stack), "kms:Decrypt");
    });
  });
});
