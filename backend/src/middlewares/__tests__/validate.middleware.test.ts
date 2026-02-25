import { validateRequest } from "../validate.middleware";
import { z } from "zod";

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("validateRequest", () => {
  it("should call next() when no schema provided", async () => {
    const req: any = { body: {}, query: {}, params: {} };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest({})(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should validate body and call next on success", async () => {
    const schema = { body: z.object({ name: z.string() }) };
    const req: any = { body: { name: "Alice" }, query: {}, params: {} };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: "Alice" });
  });

  it("should return 400 on body ZodError", async () => {
    const schema = { body: z.object({ age: z.number() }) };
    const req: any = { body: { age: "not-a-number" }, query: {}, params: {} };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Validation Error", details: expect.any(Array) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should validate query and call next on success", async () => {
    const schema = { query: z.object({ page: z.string() }) };
    const req: any = { body: {}, query: { page: "1" }, params: {} };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should return 400 on query ZodError", async () => {
    const schema = { query: z.object({ limit: z.number() }) };
    const req: any = { body: {}, query: { limit: "bad" }, params: {} };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("should validate params and call next on success", async () => {
    const schema = { params: z.object({ id: z.string() }) };
    const req: any = { body: {}, query: {}, params: { id: "abc" } };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should return 400 on params ZodError", async () => {
    const schema = { params: z.object({ id: z.number() }) };
    const req: any = { body: {}, query: {}, params: { id: "not-number" } };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("should validate body + query + params together", async () => {
    const schema = {
      body: z.object({ name: z.string() }),
      query: z.object({ page: z.string() }),
      params: z.object({ id: z.string() }),
    };
    const req: any = { body: { name: "Bob" }, query: { page: "2" }, params: { id: "xyz" } };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should include path and message in ZodError details", async () => {
    const schema = { body: z.object({ email: z.string().email() }) };
    const req: any = { body: { email: "not-email" }, query: {}, params: {} };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.details[0]).toHaveProperty("path");
    expect(jsonArg.details[0]).toHaveProperty("message");
  });

  it("should return 500 on non-ZodError", async () => {
    const schema = {
      body: {
        parseAsync: jest.fn().mockRejectedValue(new Error("Unexpected error")),
      } as any,
    };
    const req: any = { body: {}, query: {}, params: {} };
    const res = makeRes();
    const next = jest.fn();
    await validateRequest(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    expect(next).not.toHaveBeenCalled();
  });
});
