import { describe, expect, it } from "vitest";

import { buildTweetUrl, getLatestTweetId, sortTweetsAscending } from "../../src/domain/tweet";

describe("tweet domain", () => {
  it("builds a fixupx.com tweet URL", () => {
    expect(buildTweetUrl("@su8ru", "1800000000000000001")).toBe(
      "https://fixupx.com/su8ru/status/1800000000000000001",
    );
  });

  it("sorts tweets from oldest to newest", () => {
    expect(
      sortTweetsAscending([
        { id: "1800000000000000003" },
        { id: "1800000000000000001" },
        { id: "1800000000000000002" },
      ]),
    ).toEqual([
      { id: "1800000000000000001" },
      { id: "1800000000000000002" },
      { id: "1800000000000000003" },
    ]);
  });

  it("picks the newest tweet id", () => {
    expect(
      getLatestTweetId([
        { id: "1800000000000000002" },
        { id: "1800000000000000004" },
        { id: "1800000000000000003" },
      ]),
    ).toBe("1800000000000000004");
  });
});
