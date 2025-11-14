"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const path = require("path");
const openapi_core_1 = require("@redocly/openapi-core");
const fs = require("fs");
function activate(context) {
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
        // 📌 Cargar .redocly.yaml si existe
        let config = undefined;
        const redoclyPath = path.join(rootPath, ".redocly.yaml");
        try {
            if (fs.existsSync(redoclyPath)) {
                console.log("🔍 Cargando configuración .redocly.yaml");
                config = await (0, openapi_core_1.loadConfig)({ configPath: redoclyPath });
            }
            else {
                console.log("⚠ No existe .redocly.yaml, usando configuración default");
                config = await (0, openapi_core_1.loadConfig)({});
            }
            // Bundle del archivo abierto
            const result = await (0, openapi_core_1.bundle)({
                ref: apiPath,
                config: config,
            });
            const yamlText = (0, openapi_core_1.stringifyYaml)(result.bundle.parsed);
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, yamlText, "utf8");
            const output = vscode.window.createOutputChannel("OpenAPI Bundle");
            output.show();
            output.appendLine("──────────────────────────────────────────────");
            output.appendLine(" 🔄 OpenAPI Bundle - Proceso iniciado");
            output.appendLine("──────────────────────────────────────────────");
            output.appendLine("");
            output.appendLine(` • Archivo procesado: ${fileName} en la carpeta openapi-dist`);
            output.appendLine(" • Validando rutas y schemas…");
            output.appendLine(" • Espera mientras procesamos tu especificación.");
            output.appendLine("");
            output.appendLine("──────────────────────────────────────────────");
            vscode.window.showInformationMessage("OpenAPI bundlado correctamente.");
        }
        catch (err) {
            vscode.window.showErrorMessage("Error al generar el bundle. Ver consola.");
            console.error("Bundle error:", err);
        }
    });
    context.subscriptions.push(disposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map