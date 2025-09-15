import * as vscode from "vscode";
import { VSCodeInstanceService, VSCodeInstance } from "./vscodeInstanceService";

// Tree data provider for VS Code instances
class VSCodeInstanceProvider implements vscode.TreeDataProvider<VSCodeInstanceTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<VSCodeInstanceTreeItem | undefined | null | void> = new vscode.EventEmitter<VSCodeInstanceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<VSCodeInstanceTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private instanceService: VSCodeInstanceService;
    private instances: VSCodeInstance[] = [];

    constructor() {
        this.instanceService = VSCodeInstanceService.getInstance();
        this.refreshInstances();
    }

    getTreeItem(element: VSCodeInstanceTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: VSCodeInstanceTreeItem): Promise<VSCodeInstanceTreeItem[]> {
        if (!element) {
            // Root level - show VS Code instances
            if (this.instances.length === 0) {
                return [new VSCodeInstanceTreeItem(
                    'No VS Code instances found',
                    vscode.TreeItemCollapsibleState.None,
                    'message'
                )];
            }

            return this.instances.map(instance => 
                new VSCodeInstanceTreeItem(
                    instance.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'vscodeInstance',
                    instance
                )
            );
        } else if (element.instance) {
            // Show instance details
            const instance = element.instance;
            const details: VSCodeInstanceTreeItem[] = [];

            if (instance.workspacePath) {
                details.push(new VSCodeInstanceTreeItem(
                    `📁 ${instance.workspacePath}`,
                    vscode.TreeItemCollapsibleState.None,
                    'workspace'
                ));
            }

            details.push(new VSCodeInstanceTreeItem(
                `🆔 PID: ${instance.pid}`,
                vscode.TreeItemCollapsibleState.None,
                'detail'
            ));

            details.push(new VSCodeInstanceTreeItem(
                `💾 Memory: ${instance.memory} MB`,
                vscode.TreeItemCollapsibleState.None,
                'detail'
            ));

            if (instance.uptime) {
                details.push(new VSCodeInstanceTreeItem(
                    `⏱️ Uptime: ${instance.uptime}`,
                    vscode.TreeItemCollapsibleState.None,
                    'detail'
                ));
            }

            if (instance.cpu > 0) {
                details.push(new VSCodeInstanceTreeItem(
                    `⚡ CPU: ${instance.cpu.toFixed(1)}%`,
                    vscode.TreeItemCollapsibleState.None,
                    'detail'
                ));
            }

            return details;
        }

        return [];
    }

    async refreshInstances(): Promise<void> {
        try {
            this.instances = await this.instanceService.getVSCodeInstances();
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error('Error refreshing instances:', error);
            vscode.window.showErrorMessage(`Failed to refresh VS Code instances: ${error}`);
        }
    }

    getInstanceByPid(pid: number): VSCodeInstance | undefined {
        return this.instances.find(instance => instance.pid === pid);
    }
}

class VSCodeInstanceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly instance?: VSCodeInstance
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.createTooltip();
        this.iconPath = this.getIcon();
        
        if (instance && contextValue === 'vscodeInstance') {
            this.description = instance.workspacePath ? 
                `${instance.workspacePath} (${instance.memory}MB)` : 
                `PID: ${instance.pid} (${instance.memory}MB)`;
        }
    }

    private createTooltip(): string {
        if (this.instance) {
            let tooltip = `VS Code Instance\n`;
            tooltip += `PID: ${this.instance.pid}\n`;
            tooltip += `Memory: ${this.instance.memory} MB\n`;
            
            if (this.instance.workspacePath) {
                tooltip += `Workspace: ${this.instance.workspacePath}\n`;
            }
            
            if (this.instance.uptime) {
                tooltip += `Uptime: ${this.instance.uptime}\n`;
            }
            
            if (this.instance.cpu > 0) {
                tooltip += `CPU: ${this.instance.cpu.toFixed(1)}%\n`;
            }
            
            return tooltip;
        }
        return this.label;
    }

    private getIcon(): vscode.ThemeIcon | undefined {
        switch (this.contextValue) {
            case 'vscodeInstance':
                return new vscode.ThemeIcon('window');
            case 'workspace':
                return new vscode.ThemeIcon('folder');
            case 'detail':
                return new vscode.ThemeIcon('info');
            case 'message':
                return new vscode.ThemeIcon('question');
            default:
                return undefined;
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log("Bot Boss - VS Code Instance Manager is now active!");

    // Create and register the tree data provider
    const provider = new VSCodeInstanceProvider();
    vscode.window.registerTreeDataProvider('vscodeInstancesExplorer', provider);

    // Register refresh command
    let refreshCommand = vscode.commands.registerCommand('bot-boss.refreshInstances', async () => {
        await provider.refreshInstances();
        vscode.window.showInformationMessage('VS Code instances refreshed!');
    });

    // Register focus instance command
    let focusCommand = vscode.commands.registerCommand('bot-boss.focusInstance', async (item: VSCodeInstanceTreeItem) => {
        if (item.instance) {
            const instanceService = VSCodeInstanceService.getInstance();
            await instanceService.focusInstance(item.instance.pid);
        }
    });

    // Register show workspace info command
    let workspaceInfoCommand = vscode.commands.registerCommand('bot-boss.openWorkspaceInfo', async (item: VSCodeInstanceTreeItem) => {
        if (item.instance) {
            const instance = item.instance;
            let info = `VS Code Instance Information\n\n`;
            info += `PID: ${instance.pid}\n`;
            info += `Memory Usage: ${instance.memory} MB\n`;
            
            if (instance.workspacePath) {
                info += `Workspace: ${instance.workspacePath}\n`;
            }
            
            if (instance.uptime) {
                info += `Uptime: ${instance.uptime}\n`;
            }
            
            if (instance.cpu > 0) {
                info += `CPU Usage: ${instance.cpu.toFixed(1)}%\n`;
            }
            
            if (instance.arguments.length > 0) {
                info += `\nCommand Line Arguments:\n`;
                instance.arguments.forEach((arg, index) => {
                    info += `  ${index + 1}. ${arg}\n`;
                });
            }

            // Show in a new document
            const doc = await vscode.workspace.openTextDocument({
                content: info,
                language: 'plaintext'
            });
            await vscode.window.showTextDocument(doc);
        }
    });

    // Auto-refresh every 30 seconds
    const autoRefreshInterval = setInterval(async () => {
        await provider.refreshInstances();
    }, 30000);

    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(focusCommand);
    context.subscriptions.push(workspaceInfoCommand);
    context.subscriptions.push({
        dispose: () => clearInterval(autoRefreshInterval)
    });
}

export function deactivate() {
    console.log("Bot Boss - VS Code Instance Manager is now deactivated!");
}
