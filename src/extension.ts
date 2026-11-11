import * as vscode from "vscode";
import * as path from "path";
import {
  loadConfig,
  bundle,
  parseYaml,
  stringifyYaml,
} from "@redocly/openapi-core";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const pascalCaseApiTypes = new Set(["PU", "PV", "OP"]);

function containsGroupExtensions(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsGroupExtensions);
  }

  if (value === null || typeof value !== "object") {
    return false;
  }

  const entries = Object.entries(value);
  return entries.some(
    ([key, child]) =>
      key === "x-bcp-header-group" ||
      key === "x-bcp-response-group" ||
      containsGroupExtensions(child),
  );
}

function findGovernanceRoot(workspaceRoot: string): string | undefined {
  const candidates = [
    path.join(workspaceRoot, "governance-schemas"),
    workspaceRoot,
    path.join(workspaceRoot, "design", "governance-schemas"),
  ];

  return candidates.find((candidate) =>
    fs.existsSync(
      path.join(candidate, "schemas", "openapi", "bcp", "group-definitions"),
    ),
  );
}

async function runNodeScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  output: vscode.OutputChannel,
): Promise<void> {
  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.execPath,
      [scriptPath, ...args],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch (error) {
    const processError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    if (processError.stdout?.trim()) {
      output.appendLine(processError.stdout.trimEnd());
    }
    if (processError.stderr?.trim()) {
      output.appendLine(processError.stderr.trimEnd());
    }
    throw error;
  }

  if (stdout.trim()) {
    output.appendLine(stdout.trimEnd());
  }
  if (stderr.trim()) {
    output.appendLine(stderr.trimEnd());
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("✅ openapi-bundle-schema: activate() called");

  const disposable = vscode.commands.registerCommand("openapi-bundle-schema.bundle", async () => {

    // 🔍 Obtener el archivo que el usuario tiene abierto
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage("No hay ningún archivo abierto para bundlear.");
      return;
    }

    const apiPath = activeEditor.document.uri.fsPath;

    // Validar extensión
    if (!apiPath.endsWith(".yaml") && !apiPath.endsWith(".yml")) {
      vscode.window.showErrorMessage("El archivo abierto no es YAML. No parece ser un contrato OpenAPI.");
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("Abre una carpeta de proyecto antes de ejecutar el comando.");
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const fileName = path.basename(apiPath);
    const outputPath = path.join(rootPath, "openapi-dist", fileName);
    const output = vscode.window.createOutputChannel("OpenAPI Bundle");
    output.show();

    // 📌 Cargar .redocly.yaml si existe
    let config: any = undefined;
    const redoclyPath = path.join(rootPath, ".redocly.yaml");
    const contractBundlingPath = path.join(
      context.extensionPath,
      "src",
      "contract-bundling",
    );
    const expandScript = path.join(contractBundlingPath, "expand-contract.js");
    const normalizeScript = path.join(
      contractBundlingPath,
      "normalize-external-schemas.js",
    );
    const temporaryContractPath = path.join(
      path.dirname(apiPath),
      `.openapi-bundle-${process.pid}-${Date.now()}.yaml`,
    );
    let contractToBundle = apiPath;

    try {
      const api = parseYaml(fs.readFileSync(apiPath, "utf8"));
      const apiRecord =
        api !== null && typeof api === "object"
          ? (api as Record<string, unknown>)
          : undefined;
      const apiType = String(apiRecord?.["x-bcp-api-type"] || "").toUpperCase();
      const needsExpansion = containsGroupExtensions(api);
      const needsPascalCase = pascalCaseApiTypes.has(apiType);

      if (fs.existsSync(redoclyPath)) {
        console.log("🔍 Cargando configuración .redocly.yaml");
        config = await loadConfig({ configPath: redoclyPath });
      } else {
        console.log("⚠ No existe .redocly.yaml, usando configuración default");
        config = await loadConfig({});
      }

      if (needsExpansion) {
        const governanceRoot = findGovernanceRoot(rootPath);
        if (!governanceRoot) {
          throw new Error(
            "No se encontró schemas/openapi/bcp/group-definitions en la carpeta de trabajo, governance-schemas o design/governance-schemas.",
          );
        }

        output.appendLine(" • Expandiendo grupos de headers y respuestas…");
        await runNodeScript(
          expandScript,
          [apiPath, temporaryContractPath, governanceRoot],
          rootPath,
          output,
        );
        contractToBundle = temporaryContractPath;
      }

      if (needsPascalCase) {
        output.appendLine(" • Aplicando PascalCase a los schemas…");
        await runNodeScript(
          normalizeScript,
          [contractToBundle, temporaryContractPath, rootPath],
          rootPath,
          output,
        );
        contractToBundle = temporaryContractPath;
      }

      output.appendLine(" • Generando el bundle OpenAPI…");
      const result = await bundle({
        ref: contractToBundle,
        config: config,
      });

      const yamlText = stringifyYaml(result.bundle.parsed, { lineWidth: -1 });
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, yamlText, "utf8");

      output.appendLine("");
      output.appendLine("  ╔══════════════════════════════════════════╗");
      output.appendLine("  ║                 API BUNDLE                ║");
      output.appendLine("  ║          OpenAPI Contract Bundler         ║");
      output.appendLine("  ╚══════════════════════════════════════════╝");
      output.appendLine("  ▶ Proceso iniciado");
      output.appendLine("");
      output.appendLine(` • Archivo procesado: ${fileName} en la carpeta openapi-dist`);
      output.appendLine(" • Grupos expandidos y schemas empaquetados cuando corresponde.");
      output.appendLine("");
      output.appendLine("  Proceso finalizado correctamente.");

      vscode.window.showInformationMessage("OpenAPI bundlado correctamente.");

    } catch (err) {
      output.appendLine(`Error al generar el bundle: ${String(err)}`);
      vscode.window.showErrorMessage(`Error al generar el bundle: ${String(err)}`);
      console.error("Bundle error:", err);
    } finally {
      if (fs.existsSync(temporaryContractPath)) {
        fs.unlinkSync(temporaryContractPath);
      }
    }

  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
