import { describe, expect, it } from "vitest";
import * as domain from "./index";

describe("@aqchafold/domain", () => {
  it("loads the domain package entry point", () => {
    expect(domain).toBeDefined();
  });
});
