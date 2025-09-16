import * as vscode from "vscode";
import { VSCodeInstanceService, VSCodeInstance } from "./vscodeInstanceService";
import { SharedInstanceManager } from "./sharedInstanceManager";

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
            // Root level - show status and VS Code instances
            const children: VSCodeInstanceTreeItem[] = [];
            
            // Add live status indicator
            const statusItem = new VSCodeInstanceTreeItem(
                `🟢 Live Monitor (${this.instances.length} instances)`,
                vscode.TreeItemCollapsibleState.None,
                'status',
                undefined,
                undefined
            );
            statusItem.description = `Updated: ${new Date().toLocaleTimeString()}`;
            children.push(statusItem);
            
            if (this.instances.length === 0) {
                children.push(new VSCodeInstanceTreeItem(
                    'No VS Code instances found',
                    vscode.TreeItemCollapsibleState.None,
                    'message'
                ));
                return children;
            }

            // Add all instances
            const instanceItems = this.instances.map(instance => {
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
            
            children.push(...instanceItems);
            return children;
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

            // GitHub Copilot information section
            if (instance.copilotInfo) {
                const copilot = instance.copilotInfo;
                const statusIcon = this.getCopilotStatusIcon(copilot.status);
                const statusColor = this.getCopilotStatusColor(copilot.status);
                
                let copilotLabel = `${statusIcon} Copilot: ${copilot.status}`;
                if (!copilot.isInstalled) {
                    copilotLabel = '❌ Copilot: Not Installed';
                } else if (!copilot.isActive) {
                    copilotLabel = '⏸️ Copilot: Inactive';
                } else if (copilot.version) {
                    copilotLabel += ` (v${copilot.version})`;
                }

                const copilotItem = new VSCodeInstanceTreeItem(
                    copilotLabel,
                    vscode.TreeItemCollapsibleState.None,
                    'copilot-status'
                );
                
                // Add description with last activity if available
                if (copilot.lastActivity) {
                    const lastActivity = new Date(copilot.lastActivity);
                    copilotItem.description = `Last: ${lastActivity.toLocaleTimeString()}`;
                }

                details.push(copilotItem);

                // Show error if there is one
                if (copilot.error) {
                    details.push(new VSCodeInstanceTreeItem(
                        `⚠️ Error: ${copilot.error}`,
                        vscode.TreeItemCollapsibleState.None,
                        'copilot-error'
                    ));
                }
            } else {
                details.push(new VSCodeInstanceTreeItem(
                    '❓ Copilot: Status Unknown',
                    vscode.TreeItemCollapsibleState.None,
                    'copilot-unknown'
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
            const newInstances = await this.instanceService.getVSCodeInstances();
            // Determine if there are meaningful changes before firing event to preserve tooltips during hover
            const changed = this.haveInstancesChanged(this.instances, newInstances);
            this.instances = newInstances;
            if (changed) {
                this._onDidChangeTreeData.fire();
            }
        } catch (error) {
            console.error('Error refreshing instances:', error);
            
            // Don't show error message on every refresh failure - just log it
            // Only show error if we have no instances at all
            if (this.instances.length === 0) {
                vscode.window.showErrorMessage(`Failed to refresh VS Code instances: ${error}`);
            }
            
            // Try to recover by using cached data if available
            if (this.instances.length > 0) {
                console.log('Using cached instance data due to refresh error');
                this._onDidChangeTreeData.fire();
            }
        }
    }

    private haveInstancesChanged(oldList: VSCodeInstance[], newList: VSCodeInstance[]): boolean {
        if (oldList.length !== newList.length) return true;
        const byKey = (inst: VSCodeInstance) => inst.workspacePath || `pid_${inst.pid}`;
        const oldMap = new Map(oldList.map(i => [byKey(i), i]));
        for (const n of newList) {
            const o = oldMap.get(byKey(n));
            if (!o) return true;
            // Compare fields that affect UI (avoid uptime / memory churn causing tooltip flicker)
            if (o.name !== n.name) return true;
            if ((o.gitInfo?.branch) !== (n.gitInfo?.branch)) return true;
            if ((o.gitInfo?.hasChanges) !== (n.gitInfo?.hasChanges)) return true;
            if ((o.gitInfo?.ahead) !== (n.gitInfo?.ahead)) return true;
            if ((o.gitInfo?.behind) !== (n.gitInfo?.behind)) return true;
            if ((o.copilotInfo?.status) !== (n.copilotInfo?.status)) return true;
        }
        return false;
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

    private getCopilotStatusIcon(status: string): string {
        switch (status) {
            case 'Initializing': return '🟤';
            case 'Idle': return '🟢';
            case 'Running': return '🟢';
            case 'Generating': return '⚙️';
            case 'Waiting for Approval': return '🟡';
            case 'SigninRequired': return '🔐';
            case 'Unauthorized': return '🚫';
            case 'RateLimited': return '⏳';
            case 'Failed': return '🔴';
            case 'Error': return '🛑';
            case 'Done': return '✅';
            case 'Disabled': return '⚫';
            default: return '❓';
        }
    }

    private getCopilotStatusColor(status: string): string {
        switch (status) {
            case 'Initializing': return 'brown';
            case 'Idle': return 'green';
            case 'Running': return 'green';
            case 'Generating': return 'blue';
            case 'Waiting for Approval': return 'yellow';
            case 'SigninRequired': return 'orange';
            case 'Unauthorized': return 'orange';
            case 'RateLimited': return 'magenta';
            case 'Failed': return 'red';
            case 'Error': return 'red';
            case 'Done': return 'cyan';
            case 'Disabled': return 'gray';
            default: return 'gray';
        }
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
        
        // Add uptime if available
        if (this.instance.uptime) {
            desc += ` • ${this.instance.uptime}`;
        }
        
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
        
        // Add Copilot status
        if (this.instance.copilotInfo) {
            const copilot = this.instance.copilotInfo;
            if (copilot.isInstalled) {
                const statusIcon = this.getCopilotStatusIcon(copilot.status);
                desc += ` • ${statusIcon}${copilot.status}`;
            } else {
                desc += ` • ❌Copilot`;
            }
        }
        
        return desc;
    }

    private getCopilotStatusIcon(status: string): string {
        switch (status) {
            case 'Initializing': return '🟤';
            case 'Idle': return '🟢';
            case 'Running': return '🟢';
            case 'Generating': return '⚙️';
            case 'Waiting for Approval': return '🟡';
            case 'SigninRequired': return '🔐';
            case 'Unauthorized': return '🚫';
            case 'RateLimited': return '⏳';
            case 'Failed': return '🔴';
            case 'Error': return '🛑';
            case 'Done': return '✅';
            case 'Disabled': return '⚫';
            default: return '❓';
        }
    }

    private createTooltip(): string {
        if (this.instance) {
            let tooltip = `VS Code Instance (Live)\n`;
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
            
            // Add git information if available
            if (this.instance.gitInfo?.isGitRepo) {
                tooltip += `\n--- Git Info ---\n`;
                if (this.instance.gitInfo.branch) {
                    tooltip += `Branch: ${this.instance.gitInfo.branch}\n`;
                }
                if (this.instance.gitInfo.hasChanges !== undefined) {
                    tooltip += `Changes: ${this.instance.gitInfo.hasChanges ? 'Yes' : 'No'}\n`;
                }
                if (this.instance.gitInfo.ahead || this.instance.gitInfo.behind) {
                    tooltip += `Sync: `;
                    if (this.instance.gitInfo.ahead) tooltip += `↑${this.instance.gitInfo.ahead} `;
                    if (this.instance.gitInfo.behind) tooltip += `↓${this.instance.gitInfo.behind}`;
                    tooltip += `\n`;
                }
            }

            // Add Copilot information if available
            if (this.instance.copilotInfo) {
                tooltip += `\n--- GitHub Copilot ---\n`;
                const copilot = this.instance.copilotInfo;
                tooltip += `Installed: ${copilot.isInstalled ? 'Yes' : 'No'}\n`;
                if (copilot.isInstalled) {
                    tooltip += `Active: ${copilot.isActive ? 'Yes' : 'No'}\n`;
                    tooltip += `Status: ${copilot.status}\n`;
                    if (copilot.version) {
                        tooltip += `Version: ${copilot.version}\n`;
                    }
                    if (copilot.lastActivity) {
                        const lastActivity = new Date(copilot.lastActivity);
                        tooltip += `Last Activity: ${lastActivity.toLocaleString()}\n`;
                    }
                    if (copilot.error) {
                        tooltip += `Error: ${copilot.error}\n`;
                    }
                }
            }
            
            tooltip += `\nLast seen: ${new Date().toLocaleTimeString()}`;
            return tooltip;
        }
        
        if (this.contextValue === 'status') {
            return `Live monitoring active\nAuto-refresh every 10 seconds\nFile watcher enabled`;
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
            case 'copilot-status':
                return new vscode.ThemeIcon('github');
            case 'copilot-error':
                return new vscode.ThemeIcon('error');
            case 'copilot-unknown':
                return new vscode.ThemeIcon('question');
            case 'detail':
                return new vscode.ThemeIcon('info');
            case 'message':
                return new vscode.ThemeIcon('question');
            case 'status':
                return new vscode.ThemeIcon('pulse');
            default:
                return undefined;
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log("Bot Boss - VS Code Instance Manager is now active!");

    // Initialize SharedInstanceManager and register current instance
    const sharedManager = SharedInstanceManager.getInstance();
    sharedManager.registerCurrentInstance().catch(error => {
        console.error('Failed to register current instance:', error);
    });

    // Create and register the tree data provider
    const provider = new VSCodeInstanceProvider();
    vscode.window.registerTreeDataProvider('vscodeInstancesExplorer', provider);

    // Set up real-time updates via file watcher
    sharedManager.onSharedFileChange(() => {
        console.log('Shared file changed - refreshing instances');
        provider.refreshInstances().catch(error => {
            console.error('Failed to refresh instances on file change:', error);
        });
    });

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

            // GitHub Copilot information
            if (instance.copilotInfo) {
                info += `\n--- GitHub Copilot ---\n`;
                const copilot = instance.copilotInfo;
                info += `Installed: ${copilot.isInstalled ? 'Yes' : 'No'}\n`;
                if (copilot.isInstalled) {
                    info += `Active: ${copilot.isActive ? 'Yes' : 'No'}\n`;
                    info += `Status: ${copilot.status}\n`;
                    if (copilot.version) {
                        info += `Version: ${copilot.version}\n`;
                    }
                    if (copilot.lastActivity) {
                        const lastActivity = new Date(copilot.lastActivity);
                        info += `Last Activity: ${lastActivity.toLocaleString()}\n`;
                    }
                    if (copilot.error) {
                        info += `Error: ${copilot.error}\n`;
                    }
                }
            } else {
                info += `\n--- GitHub Copilot ---\n`;
                info += `Status: Information not available\n`;
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

    // Register raw Copilot debug command
    const rawCopilotCommand = vscode.commands.registerCommand('bot-boss.debugCopilotRaw', async () => {
        const instanceService = VSCodeInstanceService.getInstance();
        // Force refresh just this window's Copilot info
        const copilotInfo = await instanceService.getCopilotInfo();
        const lines: string[] = [];
        lines.push('Raw Copilot Detection Report');
        lines.push(`Generated: ${new Date().toLocaleString()}`);
        lines.push('');
        lines.push(`Installed: ${copilotInfo.isInstalled}`);
        lines.push(`Active: ${copilotInfo.isActive}`);
        lines.push(`Version: ${copilotInfo.version || 'N/A'}`);
        lines.push(`Mapped Status: ${copilotInfo.status}`);
        if (copilotInfo.detailHint) lines.push(`Detail Hint: ${copilotInfo.detailHint}`);
        if (copilotInfo.error) lines.push(`Error: ${copilotInfo.error}`);
        if (copilotInfo.lastActivity) lines.push(`Last Activity: ${copilotInfo.lastActivity}`);
        lines.push('');
        lines.push('Enable verbose logging by setting env var BOT_BOSS_DEBUG=1 before starting VS Code.');
        const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    });

    // Register force registration command for testing
    let forceRegisterCommand = vscode.commands.registerCommand('bot-boss.forceRegister', async () => {
        const sharedManager = SharedInstanceManager.getInstance();
        await sharedManager.registerCurrentInstance();
        vscode.window.showInformationMessage('Force registered current instance to shared file!');
        
        // Also refresh the view
        await provider.refreshInstances();
    });

    // Register shared file status command
    let statusCommand = vscode.commands.registerCommand('bot-boss.showSharedFileStatus', async () => {
        const sharedManager = SharedInstanceManager.getInstance();
        const instances = await sharedManager.getAllInstances();
        
        let statusInfo = `Shared File Status\n\n`;
        statusInfo += `Total instances: ${instances.length}\n`;
    statusInfo += `Update interval: 10 seconds\n`;
        statusInfo += `File watcher: Active\n`;
        statusInfo += `Last check: ${new Date().toLocaleString()}\n\n`;
        
        if (instances.length > 0) {
            statusInfo += `--- Instance Details ---\n`;
            instances.forEach((instance, index) => {
                statusInfo += `${index + 1}. ${instance.name}\n`;
                statusInfo += `   PID: ${instance.pid}\n`;
                statusInfo += `   Memory: ${instance.memory}MB\n`;
                statusInfo += `   Workspace: ${instance.workspacePath || 'None'}\n\n`;
            });
        }

        // Show in a new document
        const doc = await vscode.workspace.openTextDocument({
            content: statusInfo,
            language: 'plaintext'
        });
        await vscode.window.showTextDocument(doc);
    });

    // Auto-refresh every 10 seconds (reduced from 3s to limit tooltip flicker and resource usage)
    const autoRefreshInterval = setInterval(async () => {
        await provider.refreshInstances();
    }, 10000);

    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(focusCommand);
    context.subscriptions.push(workspaceInfoCommand);
    context.subscriptions.push(debugCommand);
    context.subscriptions.push(rawCopilotCommand);
    context.subscriptions.push(forceRegisterCommand);
    context.subscriptions.push(statusCommand);
    
    // Command: Show aggregated Copilot status across instances
    const copilotStatusCommand = vscode.commands.registerCommand('bot-boss.showCopilotStatus', async () => {
        await provider.refreshInstances();
        const instances = (provider as any).instances as VSCodeInstance[]; // access private for reporting
        const lines: string[] = [];
        lines.push('GitHub Copilot Status Summary');
        lines.push(`Generated: ${new Date().toLocaleString()}`);
        lines.push('');
        if (!instances || instances.length === 0) {
            lines.push('No instances detected.');
        } else {
            for (const inst of instances) {
                const c = inst.copilotInfo;
                if (!c) {
                    lines.push(`${inst.name}: ❓ Unknown (no data)`);
                    continue;
                }
                const iconMap: Record<string,string> = {
                    Initializing:'🟤', Idle:'🟢', Running:'🟢', Generating:'⚙️', 'Waiting for Approval':'🟡', SigninRequired:'🔐', Unauthorized:'🚫', RateLimited:'⏳', Failed:'🔴', Error:'🛑', Done:'✅', Disabled:'⚫', Unknown:'❓'
                };
                const icon = iconMap[c.status] || '❓';
                let line = `${inst.name}: ${icon} ${c.status}`;
                if (c.version) line += ` (v${c.version})`;
                if (c.detailHint) line += ` - ${c.detailHint}`;
                lines.push(line);
            }
        }
        lines.push('\nStatus Meanings:');
        lines.push('🟤 Initializing: Starting services (wait)');
        lines.push('🟢 Idle/Running: Ready for suggestions');
        lines.push('⚙️ Generating: Working on a completion');
        lines.push('🟡 Waiting for Approval: Needs policy/admin approval');
        lines.push('🔐 SigninRequired: Sign in to GitHub to enable Copilot');
        lines.push('🚫 Unauthorized: Auth failed / insufficient rights (re-auth)');
        lines.push('⏳ RateLimited: Too many requests (pause)');
        lines.push('🔴 Failed / 🛑 Error: Fault state – check logs / reload');
        lines.push('✅ Done: Last task completed');
        lines.push('⚫ Disabled: Extension inactive or not installed');
        lines.push('❓ Unknown: State not determined');

        const doc = await vscode.workspace.openTextDocument({content: lines.join('\n'), language: 'markdown'});
        await vscode.window.showTextDocument(doc, { preview: true });
    });
    context.subscriptions.push(copilotStatusCommand);
    context.subscriptions.push({
        dispose: () => clearInterval(autoRefreshInterval)
    });

    // Register cleanup for SharedInstanceManager
    context.subscriptions.push({
        dispose: async () => {
            await sharedManager.cleanup();
        }
    });
}

export function deactivate() {
    console.log("Bot Boss - VS Code Instance Manager is now deactivated!");
    
    // Cleanup SharedInstanceManager
    const sharedManager = SharedInstanceManager.getInstance();
    sharedManager.cleanup().catch(error => {
        console.error('Failed to cleanup SharedInstanceManager:', error);
    });
}
