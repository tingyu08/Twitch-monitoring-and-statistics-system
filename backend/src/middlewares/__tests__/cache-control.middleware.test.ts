import {
  staticDataCache,
  semiStaticCache,
  dynamicCache,
  privateDataCache,
  privateStaticCache,
  noCache,
} from "../cache-control.middleware";

const makeReqResNext = () => {
  const req: any = {};
  const headers: Record<string, string> = {};
  const res: any = {
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
  };
  const next = jest.fn();
  return { req, res, next, headers };
};

describe("Cache-Control Middleware", () => {
  describe("staticDataCache", () => {
    it("should set public max-age=300 and call next", () => {
      const { req, res, next, headers } = makeReqResNext();
      staticDataCache(req, res, next);
      expect(headers["Cache-Control"]).toBe("public, max-age=300, stale-while-revalidate=600");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("semiStaticCache", () => {
    it("should set public max-age=30 and call next", () => {
      const { req, res, next, headers } = makeReqResNext();
      semiStaticCache(req, res, next);
      expect(headers["Cache-Control"]).toBe("public, max-age=30, stale-while-revalidate=60");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("dynamicCache", () => {
    it("should set public max-age=10 and call next", () => {
      const { req, res, next, headers } = makeReqResNext();
      dynamicCache(req, res, next);
      expect(headers["Cache-Control"]).toBe("public, max-age=10, must-revalidate");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("privateDataCache", () => {
    it("should set private max-age=30 and call next", () => {
      const { req, res, next, headers } = makeReqResNext();
      privateDataCache(req, res, next);
      expect(headers["Cache-Control"]).toBe("private, max-age=30, stale-while-revalidate=60");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("privateStaticCache", () => {
    it("should set private max-age=120 and call next", () => {
      const { req, res, next, headers } = makeReqResNext();
      privateStaticCache(req, res, next);
      expect(headers["Cache-Control"]).toBe("private, max-age=120, stale-while-revalidate=240");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("noCache", () => {
    it("should set no-store headers and call next", () => {
      const { req, res, next, headers } = makeReqResNext();
      noCache(req, res, next);
      expect(headers["Cache-Control"]).toBe("no-store, no-cache, must-revalidate, proxy-revalidate");
      expect(headers["Pragma"]).toBe("no-cache");
      expect(headers["Expires"]).toBe("0");
      expect(next).toHaveBeenCalled();
    });
  });
});
