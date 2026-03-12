import { getSingleStringValue, getStringWithDefault } from "../request-values";

describe("request-values", () => {
  describe("getSingleStringValue", () => {
    it("returns the value when input is a string", () => {
      expect(getSingleStringValue("hello")).toBe("hello");
    });

    it("returns the first value when input is a string array", () => {
      expect(getSingleStringValue(["first", "second"])).toBe("first");
    });

    it("returns undefined when first array value is not a string", () => {
      expect(getSingleStringValue([123, "second"])).toBeUndefined();
    });

    it("returns undefined for non-string non-array input", () => {
      expect(getSingleStringValue(123)).toBeUndefined();
      expect(getSingleStringValue({ foo: "bar" })).toBeUndefined();
      expect(getSingleStringValue(undefined)).toBeUndefined();
      expect(getSingleStringValue(null)).toBeUndefined();
    });
  });

  describe("getStringWithDefault", () => {
    it("returns the parsed string value when present", () => {
      expect(getStringWithDefault("value", "fallback")).toBe("value");
      expect(getStringWithDefault(["value"], "fallback")).toBe("value");
    });

    it("returns fallback when parsed value is undefined", () => {
      expect(getStringWithDefault([123], "fallback")).toBe("fallback");
      expect(getStringWithDefault(undefined, "fallback")).toBe("fallback");
    });
  });
});
