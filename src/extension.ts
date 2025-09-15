import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    console.log("My VS Code Extension is now active!");

    // Register the hello world command
    let disposable = vscode.commands.registerCommand("my-vscode-extension.helloWorld", () => {
        vscode.window.showInformationMessage("Hello World from My VS Code Extension!");
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    console.log("My VS Code Extension is now deactivated!");
}
