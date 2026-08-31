import {
  assertArrayLength,
  assertIdentical,
  assertObjectEquals,
} from "@kensio/smartass";
import { S3Client } from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { SimAws } from "@kensio/yulin";
import { SimSdk } from "@kensio/yulin/sdk";
import { describe, it } from "vitest";

import { neverComputed } from "../rollup-summaries.js";
import { openReportStore } from "./report-store.js";

describe("reading calendar report source objects", () => {
  it("preserves key order across bounded S3 read batches", async () => {
    // Given 55 source keys spanning two read batches, with one missing at
    // their boundary.
    const bucket = `rainlytics-summaries-${faker.string.uuid()}`;
    const keys = Array.from(
      { length: 55 },
      (_, index) => `summaries/${String(index)}.json`,
    );
    const missingIndex = 50;
    const simAws = new SimAws();
    await simAws.s3().createBucket({ input: { Bucket: bucket } });
    await Promise.all(
      keys.map(async (key, index) => {
        if (index === missingIndex) {
          return;
        }

        await simAws.s3().putObject({
          input: { Bucket: bucket, Key: key, Body: JSON.stringify({ index }) },
        });
      }),
    );
    using simSdk = new SimSdk({ simAws });
    simSdk.intercept(S3Client);
    const store = await openReportStore(bucket);

    // When every key is read in one request to the store.
    const found = await store.read(keys);
    store.close();

    // Then both batches retain input order and the missing key retains its
    // position between them.
    assertArrayLength(found, keys.length);
    assertObjectEquals(found[49], { index: 49 });
    assertIdentical(found[missingIndex], neverComputed);
    assertObjectEquals(found[51], { index: 51 });
  });
});
