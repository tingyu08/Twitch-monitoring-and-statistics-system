import { z } from "zod";

const languageCodeRegex = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export const updateSettingsSchema = {
  body: z
    .object({
      title: z.string().trim().min(1).max(140).optional(),
      gameId: z.string().trim().min(1).max(64).optional(),
      tags: z.array(z.string().trim().min(1).max(25)).max(10).optional(),
      language: z.string().trim().regex(languageCodeRegex, "Invalid language code").optional(),
    })
    .refine((payload) => Object.keys(payload).length > 0, {
      message: "At least one field is required",
    }),
};

export const createTemplateSchema = {
  body: z.object({
    templateName: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(140),
    gameId: z.string().trim().min(1).max(64).optional(),
    gameName: z.string().trim().min(1).max(120).optional(),
    tags: z.array(z.string().trim().min(1).max(25)).max(10).optional(),
    language: z.string().trim().regex(languageCodeRegex, "Invalid language code").optional(),
  }),
};
