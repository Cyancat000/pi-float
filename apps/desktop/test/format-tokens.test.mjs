import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTokens } from "../src/format-tokens.ts";

test("token counts use one decimal for K/M and preserve small counts", () => {
  for (const [tokens, expected] of [
    [0, "0"], [999, "999"], [1_000, "1.0K"], [1_250, "1.3K"],
    [9_950, "10.0K"], [999_949, "999.9K"], [999_950, "1.0M"],
    [1_050_000, "1.1M"], [2_000_000, "2.0M"],
  ]) assert.equal(formatTokens(tokens), expected, `${tokens} tokens`);
});
