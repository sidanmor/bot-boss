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

            return this.instances.map(instance => {
                const treeItem = new VSCodeInstanceTreeItem(
                    instance.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'vscodeInstance',
                    instance,
                    {
                        command: 'bot-boss.focusInstance',
                        title: 'Focus Window',
                        arguments: [{ instance }]
                    }
                );
                return treeItem;
            });
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

            // Git information section
            if (instance.gitInfo?.isGitRepo) {
                if (instance.gitInfo.branch) {
                    let gitLabel = `🌿 Branch: ${instance.gitInfo.branch}`;
                    if (instance.gitInfo.hasChanges) {
                        gitLabel += ' (uncommitted changes)';
                    }
                    details.push(new VSCodeInstanceTreeItem(
                        gitLabel,
                        vscode.TreeItemCollapsibleState.None,
                        'git-branch'
                    ));
                }

                if (instance.gitInfo.ahead || instance.gitInfo.behind) {
                    let syncLabel = '🔄 ';
                    if (instance.gitInfo.ahead && instance.gitInfo.ahead > 0) {
                        syncLabel += `↑${instance.gitInfo.ahead} ahead`;
                    }
                    if (instance.gitInfo.behind && instance.gitInfo.behind > 0) {
                        if (instance.gitInfo.ahead && instance.gitInfo.ahead > 0) {
                            syncLabel += ', ';
                        }
                        syncLabel += `↓${instance.gitInfo.behind} behind`;
                    }
                    details.push(new VSCodeInstanceTreeItem(
                        syncLabel,
                        vscode.TreeItemCollapsibleState.None,
                        'git-sync'
                    ));
                }

                if (instance.gitInfo.lastCommit) {
                    details.push(new VSCodeInstanceTreeItem(
                        `📝 ${instance.gitInfo.lastCommit}`,
                        vscode.TreeItemCollapsibleState.None,
                        'git-commit'
                    ));
                }

                if (instance.gitInfo.remoteUrl) {
                    details.push(new VSCodeInstanceTreeItem(
                        `🌐 ${this.formatRemoteUrl(instance.gitInfo.remoteUrl)}`,
                        vscode.TreeItemCollapsibleState.None,
                        'git-remote'
                    ));
                }
            } else if (instance.workspacePath) {
                details.push(new VSCodeInstanceTreeItem(
                    '📄 Not a git repository',
                    vscode.TreeItemCollapsibleState.None,
                    'no-git'
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

    private formatRemoteUrl(url: string): string {
        // Convert SSH URLs to HTTPS for better readability
        if (url.startsWith('git@')) {
            // git@github.com:user/repo.git -> github.com/user/repo
            return url.replace('git@', '').replace(':', '/').replace('.git', '');
        }
        // https://github.com/user/repo.git -> github.com/user/repo
        return url.replace('https://', '').replace('.git', '');
    }
}

class VSCodeInstanceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly instance?: VSCodeInstance,
        command?: vscode.Command
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.createTooltip();
        this.iconPath = this.getIcon();
        this.command = command;
        
        if (instance && contextValue === 'vscodeInstance') {
            this.description = this.createDescription();
        }
    }

    private createDescription(): string {
        if (!this.instance) return '';
        
        let desc = `${this.instance.memory}MB`;
        
        if (this.instance.gitInfo?.isGitRepo && this.instance.gitInfo.branch) {
            desc += ` • ${this.instance.gitInfo.branch}`;
            
            if (this.instance.gitInfo.hasChanges) {
                desc += ' (*)';
            }
            
            if (this.instance.gitInfo.ahead && this.instance.gitInfo.ahead > 0) {
                desc += ` ↑${this.instance.gitInfo.ahead}`;
            }
            
            if (this.instance.gitInfo.behind && this.instance.gitInfo.behind > 0) {
                desc += ` ↓${this.instance.gitInfo.behind}`;
            }
        }
        
        return desc;
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
            case 'git-branch':
                return new vscode.ThemeIcon('git-branch');
            case 'git-sync':
                return new vscode.ThemeIcon('sync');
            case 'git-commit':
                return new vscode.ThemeIcon('git-commit');
            case 'git-remote':
                return new vscode.ThemeIcon('globe');
            case 'no-git':
                return new vscode.ThemeIcon('file');
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
    let focusCommand = vscode.commands.registerCommand('bot-boss.focusInstance', async (item: any) => {
        let instance: VSCodeInstance | undefined;
        
        if (item && item.instance) {
            // Called from tree item
            instance = item.instance;
        } else if (item && typeof item === 'object' && item.pid) {
            // Called directly with instance
            instance = item;
        }
        
        if (instance) {
            const instanceService = VSCodeInstanceService.getInstance();
            await instanceService.focusInstance(instance.pid);
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

            // Git information
            if (instance.gitInfo?.isGitRepo) {
                info += `\n--- Git Information ---\n`;
                if (instance.gitInfo.branch) {
                    info += `Branch: ${instance.gitInfo.branch}\n`;
                }
                if (instance.gitInfo.hasChanges) {
                    info += `Status: Uncommitted changes\n`;
                } else {
                    info += `Status: Clean working tree\n`;
                }
                if (instance.gitInfo.lastCommit) {
                    info += `Last Commit: ${instance.gitInfo.lastCommit}\n`;
                }
                if (instance.gitInfo.remoteUrl) {
                    info += `Remote: ${instance.gitInfo.remoteUrl}\n`;
                }
                if (instance.gitInfo.ahead || instance.gitInfo.behind) {
                    info += `Sync: `;
                    if (instance.gitInfo.ahead && instance.gitInfo.ahead > 0) {
                        info += `${instance.gitInfo.ahead} commits ahead`;
                    }
                    if (instance.gitInfo.behind && instance.gitInfo.behind > 0) {
                        if (instance.gitInfo.ahead && instance.gitInfo.ahead > 0) {
                            info += ', ';
                        }
                        info += `${instance.gitInfo.behind} commits behind`;
                    }
                    info += `\n`;
                }
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

    // Register debug command to manually test detection
    let debugCommand = vscode.commands.registerCommand('bot-boss.debugDetection', async () => {
        const instanceService = VSCodeInstanceService.getInstance();
        const instances = await instanceService.getVSCodeInstances();
        vscode.window.showInformationMessage(`Debug: Found ${instances.length} VS Code instances. Check Debug Console for details.`);
    });

    // Auto-refresh every 30 seconds
    const autoRefreshInterval = setInterval(async () => {
        await provider.refreshInstances();
    }, 30000);

    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(focusCommand);
    context.subscriptions.push(workspaceInfoCommand);
    context.subscriptions.push(debugCommand);
    context.subscriptions.push({
        dispose: () => clearInterval(autoRefreshInterval)
    });
}

export function deactivate() {
    console.log("Bot Boss - VS Code Instance Manager is now deactivated!");
}
