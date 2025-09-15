import * as vscode from "vscode";

// Tree data provider for the custom view
class MyExtensionProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            // Root level items
            return Promise.resolve([
                new TreeItem('Item 1', vscode.TreeItemCollapsibleState.None, {
                    command: 'my-vscode-extension.helloWorld',
                    title: 'Hello World',
                    arguments: []
                }),
                new TreeItem('Item 2', vscode.TreeItemCollapsibleState.None),
                new TreeItem('Folder', vscode.TreeItemCollapsibleState.Collapsed)
            ]);
        } else if (element.label === 'Folder') {
            // Child items for the folder
            return Promise.resolve([
                new TreeItem('Sub Item 1', vscode.TreeItemCollapsibleState.None),
                new TreeItem('Sub Item 2', vscode.TreeItemCollapsibleState.None)
            ]);
        }
        return Promise.resolve([]);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

class TreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label}`;
        this.description = this.label === 'Item 1' ? 'Click me!' : '';
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log("My VS Code Extension is now active!");

    // Register the hello world command
    let disposable = vscode.commands.registerCommand("my-vscode-extension.helloWorld", () => {
        vscode.window.showInformationMessage("Hello World from My VS Code Extension!");
    });

    // Create and register the tree data provider
    const provider = new MyExtensionProvider();
    vscode.window.registerTreeDataProvider('myExtensionExplorer', provider);

    // Register refresh command for the view
    let refreshCommand = vscode.commands.registerCommand('my-vscode-extension.refresh', () => {
        provider.refresh();
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(refreshCommand);
}

export function deactivate() {
    console.log("My VS Code Extension is now deactivated!");
}
