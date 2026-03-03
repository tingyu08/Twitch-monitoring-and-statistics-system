import {
  createTemplateSchema,
  updateSettingsSchema,
  updateTemplateSchema,
} from "../streamer-settings.schema";

describe("streamer-settings.schema", () => {
  it("accepts valid update settings payload", () => {
    const parsed = updateSettingsSchema.body.parse({
      title: "  New title  ",
      gameId: " 123 ",
      tags: ["Tag1", "Tag2"],
      language: "zh-TW",
    });

    expect(parsed).toEqual({
      title: "New title",
      gameId: "123",
      tags: ["Tag1", "Tag2"],
      language: "zh-TW",
    });
  });

  it("rejects empty update settings payload", () => {
    const result = updateSettingsSchema.body.safeParse({});

    expect(result.success).toBe(false);
  });

  it("accepts valid create template payload", () => {
    const parsed = createTemplateSchema.body.parse({
      templateName: "  My Template ",
      title: "  Stream Title ",
      gameName: "  Game Name ",
      language: "en",
    });

    expect(parsed).toEqual({
      templateName: "My Template",
      title: "Stream Title",
      gameName: "Game Name",
      language: "en",
    });
  });

  it("accepts valid update template payload and rejects empty payload", () => {
    const valid = updateTemplateSchema.body.safeParse({ templateName: "  Updated ", language: "ja" });
    const invalid = updateTemplateSchema.body.safeParse({});

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});
