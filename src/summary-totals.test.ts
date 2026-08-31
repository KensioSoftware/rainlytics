import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import {
  browserTotals,
  cacheTotals,
  pageviewTotals,
} from "./rollup-question-totals.js";
import type { RollupSummary, SummaryRow } from "./rollup-summaries.js";
import { summarySchemaVersion } from "./rollup-summaries.js";
import { totalledRows } from "./summary-totals.js";

describe("adding several stored windows into one answer", () => {
  /** One stored window holding these rows, as the job would have written it. */
  const aWindow = (
    columns: readonly string[],
    rows: readonly SummaryRow[],
  ): RollupSummary => ({
    schemaVersion: summarySchemaVersion,
    question: {
      name: "pageviews",
      includeBots: false,
      limit: 20,
      param: "q",
      redirectStatuses: ["302"],
    },
    window: {
      granularity: "hourly",
      from: "2026-08-23T08:00:00.000Z",
      until: "2026-08-23T09:00:00.000Z",
    },
    computedAt: faker.date.recent().toISOString(),
    columns,
    rows,
  });

  /** Two hours of pageviews, holding one page in common. */
  const twoHours = [
    aWindow(
      ["path", "views"],
      [
        { path: "/", views: "5" },
        { path: "/grammar/", views: "2" },
      ],
    ),
    aWindow(
      ["path", "views"],
      [
        { path: "/grammar/", views: "4" },
        { path: "/liju/", views: "1" },
      ],
    ),
  ];

  it("adds the counts of a row both windows held", () => {
    // Given two hours in which one page was looked at in both.
    // When they are added up.
    const rows = totalledRows(twoHours, pageviewTotals);

    // Then the page appears once, carrying both hours. Two rows would
    // report one page twice and rank each half of it on its own.
    expect(rows).toContainEqual({ path: "/grammar/", views: "6" });
  });

  it("keeps device classes apart inside one browser family", () => {
    // Given two windows where Chrome appears on mobile and desktop, with
    // only the mobile row present in both.
    const hours = [
      aWindow(
        ["browser", "device", "views"],
        [
          { browser: "Chrome family", device: "Mobile", views: "3" },
          { browser: "Chrome family", device: "Desktop", views: "2" },
        ],
      ),
      aWindow(
        ["browser", "device", "views"],
        [{ browser: "Chrome family", device: "Mobile", views: "4" }],
      ),
    ];

    // When the stored windows are added.
    const rows = totalledRows(hours, browserTotals);

    // Then browser and device together identify a row. Grouping on the
    // browser alone would erase the device breakdown while appearing to add.
    expect(rows).toStrictEqual([
      { browser: "Chrome family", device: "Mobile", views: "7" },
      { browser: "Chrome family", device: "Desktop", views: "2" },
    ]);
  });

  it("ranks the total, not the window that came first", () => {
    // Given the same two hours. The home page leads the first and the
    // grammar page leads the total.
    // When they are added up.
    const rows = totalledRows(twoHours, pageviewTotals);

    // Then the order is the one a query over both hours would have given,
    // most looked at first with the path breaking a tie.
    expect(rows).toStrictEqual([
      { path: "/grammar/", views: "6" },
      { path: "/", views: "5" },
      { path: "/liju/", views: "1" },
    ]);
  });

  it("answers with as many rows as it was asked for", () => {
    // Given the same two hours and a row count of one.
    const rows = totalledRows(twoHours, pageviewTotals, 1);

    // Then the top row of the total comes back. Cutting each window to one
    // row first would have answered with the home page.
    expect(rows).toStrictEqual([{ path: "/grammar/", views: "6" }]);
  });

  it("works the cache percentage out again from the counts it added", () => {
    // Given two hours of cache figures. One was served entirely from cache
    // and the other missed half the time.
    const hours = [
      aWindow(
        ["hits", "misses", "hit_percent"],
        [{ hits: "30", misses: "0", hit_percent: "100.0" }],
      ),
      aWindow(
        ["hits", "misses", "hit_percent"],
        [{ hits: "5", misses: "5", hit_percent: "50.0" }],
      ),
    ];

    // When they are added up.
    const rows = totalledRows(hours, cacheTotals);

    // Then the percentage is 35 hits in 40 decided requests. Averaging the
    // two percentages would have answered 75, which is a figure about
    // neither hour.
    expect(rows).toStrictEqual([
      { hits: "35", misses: "5", hit_percent: "87.5" },
    ]);
  });

  it("leaves a percentage of nothing empty", () => {
    // Given two hours in which the cache was never asked, which is what a
    // site serving only redirects looks like.
    const hours = [
      aWindow(
        ["hits", "misses", "hit_percent"],
        // oxlint-disable-next-line unicorn/no-null
        [{ hits: "0", misses: "0", hit_percent: null }],
      ),
      aWindow(
        ["hits", "misses", "hit_percent"],
        // oxlint-disable-next-line unicorn/no-null
        [{ hits: "0", misses: "0", hit_percent: null }],
      ),
    ];

    // When they are added up.
    const [row] = totalledRows(hours, cacheTotals);

    // Then the column holds nothing, the way `nullif` leaves it in the
    // query. A zero there would report a cache that answered nothing as a
    // cache that missed everything.
    expect(row?.["hit_percent"]).toBeNull();
  });

  it("names its columns even where every window was quiet", () => {
    // Given two windows nobody visited, which the job writes as documents
    // holding no rows.
    const quiet = [
      aWindow(["path", "views"], []),
      aWindow(["path", "views"], []),
    ];

    // When they are added up.
    const rows = totalledRows(quiet, pageviewTotals);

    // Then the answer is empty. It is a different answer from a window
    // nobody computed, and whatever fetched them has already told them
    // apart.
    expect(rows).toStrictEqual([]);
  });

  it("keeps one malformed row out of a whole column", () => {
    // Given two hours in which one row carries something no count could be,
    // which is what a document written by something else can hold.
    const hours = [
      aWindow(["path", "views"], [{ path: "/", views: "3" }]),
      aWindow(["path", "views"], [{ path: "/", views: "lots" }]),
    ];

    // When they are added up.
    const rows = totalledRows(hours, pageviewTotals);

    // Then the hour that counted is still there. `NaN` in the column would
    // have taken the other hour with it.
    expect(rows).toStrictEqual([{ path: "/", views: "3" }]);
  });

  it("matches rows on a key column holding nothing", () => {
    // Given two hours whose grouped column is empty, which is what a query
    // answers where the value it read was absent.
    const hours = [
      // oxlint-disable-next-line unicorn/no-null
      aWindow(["path", "views"], [{ path: null, views: "2" }]),
      // oxlint-disable-next-line unicorn/no-null
      aWindow(["path", "views"], [{ path: null, views: "5" }]),
    ];

    // When they are added up.
    const rows = totalledRows(hours, pageviewTotals);

    // Then the two are one row. Treating an empty cell as its own key would
    // report the same nothing twice.
    // oxlint-disable-next-line unicorn/no-null
    expect(rows).toStrictEqual([{ path: null, views: "7" }]);
  });

  it("breaks a tie on the key, the way the query does", () => {
    // Given two hours in which two pages end on the same count.
    const hours = [
      aWindow(
        ["path", "views"],
        [
          { path: "/liju/", views: "2" },
          { path: "/grammar/", views: "1" },
        ],
      ),
      aWindow(["path", "views"], [{ path: "/grammar/", views: "1" }]),
    ];

    // When they are added up.
    const rows = totalledRows(hours, pageviewTotals);

    // Then the path decides, as `ORDER BY 2 DESC, 1` does for one window. A
    // reader comparing this week against last wants the tie broken the same
    // way both times.
    expect(rows).toStrictEqual([
      { path: "/grammar/", views: "2" },
      { path: "/liju/", views: "2" },
    ]);
  });

  it("refuses to add up nothing at all", () => {
    // Given no windows, which is what a caller that skipped its own check
    // would arrive with.
    // Then it says so. The columns come from the summaries, and an empty
    // pile names none.
    expect(() => totalledRows([], pageviewTotals)).toThrow(RangeError);
  });
});
