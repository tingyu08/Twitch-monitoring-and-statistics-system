-- Add consent tracking columns for viewers
PRAGMA foreign_keys=OFF;

ALTER TABLE "viewers" ADD COLUMN "consentedAt" DATETIME;
ALTER TABLE "viewers" ADD COLUMN "consentVersion" INTEGER;

PRAGMA foreign_keys=ON;
