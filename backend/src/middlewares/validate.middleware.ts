import { Request, Response, NextFunction } from "express";
import { ZodError, ZodTypeAny } from "zod";

export interface ValidationTarget {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * 通用的 Zod 驗證中間件
 * 用於驗證請求的 body, query, params
 */
export const validateRequest =
  (schema: ValidationTarget) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 驗證 body
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }

      // 驗證 query
      if (schema.query) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.query = (await schema.query.parseAsync(req.query)) as any;
      }

      // 驗證 params
      if (schema.params) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.params = (await schema.params.parseAsync(req.params)) as any;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: "Validation Error",
          details: error.issues.map((err) => ({
            path: err.path.join("."),
            message: err.message,
          })),
        });
      }

      // 其他錯誤
      return res.status(500).json({
        error: "Internal Server Error",
      });
    }
  };
