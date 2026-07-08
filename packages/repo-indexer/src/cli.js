import { scanRepository } from "./index.js";

const target = process.argv[2] || process.cwd();

try {
  const profile = await scanRepository(target);
  console.log(JSON.stringify(profile, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
