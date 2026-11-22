import test from "node:test";
import assert from "node:assert/strict";
import { rankSearchOptions } from "../frontend/components/searchable-select.js";
const option = (textContent, value = textContent) => ({ textContent, value });

test("search ranks exact, prefix, word boundary, and substring matches before alphabetical ties", () => {
  const options = [option("Ablue Bird"), option("Black-throated Blue Warbler"), option("Blue Jay"), option("Blue Grosbeak"), option("Blue"), option("Red Bird")];
  assert.deepEqual(rankSearchOptions(options, " BLUE ").map(o => o.textContent), ["Blue", "Blue Grosbeak", "Blue Jay", "Black-throated Blue Warbler", "Ablue Bird"]);
  assert.equal(rankSearchOptions(options, "Blue Jay")[0].textContent, "Blue Jay");
  assert.deepEqual(rankSearchOptions(options, "no matches"), []);
});

test("IDs remain searchable, duplicates deterministic, and disabled/empty selections excluded from search", () => {
  const options = [option("Clear", ""), option("Blue Jay", "bird-3"), option("Blue Jay", "bird-1"), { ...option("Blue", "bird-0"), disabled: true }, option("Northern Cardinal", "bird-2")];
  assert.deepEqual(rankSearchOptions(options, "blue").map(o => o.value), ["bird-1", "bird-3"]);
  assert.equal(rankSearchOptions(options, "BIRD-2")[0].textContent, "Northern Cardinal");
  assert.deepEqual(rankSearchOptions(options, ""), options.filter(o => !o.disabled));
});

test("county word boundaries include punctuation and retain canonical identifiers", () => {
  const options = [option("North-Suffolk County", "US-MA-001"), option("Suffolk County", "US-MA-025"), option("Asuffolk County", "US-MA-003")];
  assert.deepEqual(rankSearchOptions(options, "suffolk").map(o => o.value), ["US-MA-025", "US-MA-001", "US-MA-003"]);
  assert.equal(rankSearchOptions(options, "025")[0].value, "US-MA-025");
});
