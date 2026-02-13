import { readdir, readFile } from "fs/promises";
import path from "path";

const SOURCE_ROOT = path.resolve(__dirname, "..");
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SUSPICIOUS_ENCODING_PATTERN = /[�]|(?:Ã|Â|Ð|Ñ)[^\s]*/;

interface Issue {
  filePath: string;
  line: number;
  content: string;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return [fullPath];
    })
  );

  return files.flat();
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.endsWith("*/")
  );
}

async function scanFile(filePath: string): Promise<Issue[]> {
  const extension = path.extname(filePath).toLowerCase();
  if (!CODE_EXTENSIONS.has(extension)) {
    return [];
  }

  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const issues: Issue[] = [];

  lines.forEach((line, index) => {
    if (!isCommentLine(line)) {
      return;
    }

    if (!SUSPICIOUS_ENCODING_PATTERN.test(line)) {
      return;
    }

    issues.push({
      filePath,
      line: index + 1,
      content: line.trim(),
    });
  });

  return issues;
}

async function main(): Promise<void> {
  const files = await walk(SOURCE_ROOT);
  const allIssues = (await Promise.all(files.map((filePath) => scanFile(filePath)))).flat();

  if (allIssues.length === 0) {
    console.log("Comment encoding check passed.");
    return;
  }

  console.error(`Found ${allIssues.length} suspicious comment encoding issues:`);
  allIssues.slice(0, 100).forEach((issue) => {
    const relative = path.relative(process.cwd(), issue.filePath);
    console.error(`- ${relative}:${issue.line} ${issue.content}`);
  });

  process.exitCode = 1;
}

void main();
