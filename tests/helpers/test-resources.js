import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { AutomationResourceScope } from "../../scripts/automation-resource-scope.js";

const PROJECT_COPY_EXCLUSIONS = new Set([
  ".codeclaw",
  ".git",
  "coverage",
  "dist",
  "node_modules"
]);

export async function createTestResources(testContext, prefix) {
  if (!testContext || typeof testContext.after !== "function") {
    throw new TypeError("Test resources require a node:test context.");
  }

  const scope = new AutomationResourceScope();
  testContext.after(async () => {
    const errors = await scope.cleanup();
    if (errors.length) {
      throw new AggregateError(errors, `${errors.length} test resource cleanup operation(s) failed.`);
    }
  });

  const rootPath = await scope.temporaryDirectory(prefix);
  return {
    rootPath,
    stateDir: path.join(rootPath, "state"),
    lockDir: path.join(rootPath, "locks"),
    copyRoot: path.join(rootPath, "copies"),
    path: (...segments) => path.join(rootPath, ...segments),
    copyProject: (sourceRoot, name = "project") => copyProjectFixture(sourceRoot, path.join(rootPath, name)),
    execFile: (file, args, options = {}) => executeTracked(scope, file, args, options)
  };
}

export async function createIsolatedProject(testContext, sourceRoot, prefix) {
  const resources = await createTestResources(testContext, prefix);
  const projectRoot = await resources.copyProject(sourceRoot);
  return {
    ...resources,
    projectRoot,
    scriptPath: (name) => path.join(projectRoot, "scripts", name),
    execNodeScript: (name, args, options = {}) => resources.execFile(
      process.execPath,
      [path.join(projectRoot, "scripts", name), ...args],
      { cwd: projectRoot, ...options }
    )
  };
}

async function copyProjectFixture(sourceRoot, destinationRoot) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  if (destination === source || isInside(destination, source)) {
    throw new Error("An isolated project fixture must be outside the source project.");
  }

  await fs.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (sourcePath) => {
      const relative = path.relative(source, sourcePath);
      if (!relative) return true;
      const topLevel = relative.split(path.sep)[0];
      return !PROJECT_COPY_EXCLUSIONS.has(topLevel);
    }
  });
  return destination;
}

function executeTracked(scope, file, args, options) {
  const { label = `test command ${path.basename(file)}`, ...execOptions } = options;
  return new Promise((resolve, reject) => {
    const child = scope.child(execFile(file, args, execOptions, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        code: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr
      });
    }), label);
    child.once("error", reject);
  });
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
