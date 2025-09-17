import * as vscode from "vscode";
import { CopilotStatusService, summarizeCopilotStatuses } from "./copilotStatusService";
import { BotBossEditorPanel } from "./editorPanel";
import { GitHubStatusService } from "./githubStatusService";
import { logger } from "./logger";
import { Ref } from "./ref";
import { SharedInstanceManager } from "./sharedInstanceManager";
import { VSCodeInstance, VSCodeInstanceService } from "./vscodeInstanceService";

// --- Copilot specific tree view (lightweight) ---
class CopilotInstanceTreeProvider implements vscode.TreeDataProvider<CopilotTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private instanceService = VSCodeInstanceService.getInstance();
    private lastInstances: VSCodeInstance[] = [];
    private refreshTimer?: NodeJS.Timeout;
    private aggregateIntervalMs = 15000;

    constructor() {
        var x = Ref.getInstance();

        this.schedule();
        this.applyConfig();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('bot-boss.copilot.aggregateRefreshMs')) {
                this.applyConfig();
            }
        });
    }

    private applyConfig() {
        const cfg = vscode.workspace.getConfiguration('bot-boss');
        const ms = cfg.get<number>('copilot.aggregateRefreshMs');
        if (typeof ms === 'number' && ms >= 5000) {
            this.aggregateIntervalMs = ms;
            if (this.refreshTimer) {
                clearInterval(this.refreshTimer);
                this.schedule();
            }
        }
    }

    private schedule() {
        this.refresh();
        this.refreshTimer = setInterval(() => this.refresh(), this.aggregateIntervalMs);
    }

    private async refresh() {
        try {
            this.lastInstances = await this.instanceService.getVSCodeInstances();
            this._onDidChangeTreeData.fire();
        } catch { }
    }

    getTreeItem(element: CopilotTreeItem): vscode.TreeItem { return element; }

    async getChildren(element?: CopilotTreeItem): Promise<CopilotTreeItem[]> {
        if (!element) {
            const items: CopilotTreeItem[] = [];
            const infos = this.lastInstances.map(i => i.copilotInfo).filter(Boolean) as any[];
            if (!infos.length) {
                items.push(new CopilotTreeItem('No Copilot data', vscode.TreeItemCollapsibleState.None, 'info'));
                return items;
            }
            const summary = summarizeCopilotStatuses(infos);
            items.push(new CopilotTreeItem(`Worst: ${summary.worstStatus} (of ${summary.total})`, vscode.TreeItemCollapsibleState.None, 'summary'));
            Object.keys(summary.counts).sort().forEach(k => {
                items.push(new CopilotTreeItem(`${k}: ${summary.counts[k]}`, vscode.TreeItemCollapsibleState.None, 'count'));
            });
            // Instance nodes
            this.lastInstances.forEach(inst => {
                const c = inst.copilotInfo;
                const label = c ? `${inst.name}: ${c.status}` : `${inst.name}: Unknown`;
                const item = new CopilotTreeItem(label, vscode.TreeItemCollapsibleState.None, 'instance');
                item.tooltip = c ? `Installed:${c.isInstalled} Active:${c.isActive}${c.version ? ' v' + c.version : ''}${c.detailHint ? '\n' + c.detailHint : ''}` : 'No data';
                items.push(item);
            });
            return items;
        }
        return [];
    }
}

class CopilotTreeItem extends vscode.TreeItem {
    constructor(label: string, state: vscode.TreeItemCollapsibleState, context: string) { super(label, state); this.contextValue = context; }
}

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
    // Initialize logger first
    logger.initialize(context);
    logger.info("Extension", "Bot Boss - VS Code Instance Manager is now active!");

    console.log("Bot Boss - VS Code Instance Manager is now active!");

    // Initialize SharedInstanceManager and register current instance
    const sharedManager = SharedInstanceManager.getInstance();
    sharedManager.registerCurrentInstance().catch(error => {
        console.error('Failed to register current instance:', error);
    });

    // Create and register the tree data provider
    const provider = new VSCodeInstanceProvider();
    vscode.window.registerTreeDataProvider('vscodeInstancesExplorer', provider);

    // Copilot focused view
    const copilotTree = new CopilotInstanceTreeProvider();
    vscode.window.registerTreeDataProvider('copilotInstancesView', copilotTree);

    // --- Local GitHub Copilot status (current window only) ---
    const copilotStatusService = CopilotStatusService.getInstance();
    copilotStatusService.initialize(context);
    const copilotStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    copilotStatusBar.name = 'Copilot (Local)';
    copilotStatusBar.command = 'bot-boss.showCopilotStatus';

    const copilotIcon = (status: string) => {
        switch (status) {
            case 'Initializing': return '$(gear~spin)';
            case 'Generating': return '$(sync~spin)';
            case 'Idle':
            case 'Running': return '$(pass-filled)';
            case 'Waiting for Approval': return '$(clock)';
            case 'SigninRequired': return '$(account)';
            case 'Unauthorized': return '$(shield-x)';
            case 'RateLimited': return '$(watch)';
            case 'Failed':
            case 'Error': return '$(error)';
            case 'Done': return '$(check)';
            case 'Disabled': return '$(circle-slash)';
            default: return '$(question)';
        }
    };
    const copilotColor = (status: string) => {
        switch (status) {
            case 'Initializing': return new vscode.ThemeColor('statusBarItem.warningForeground');
            case 'Generating': return new vscode.ThemeColor('statusBarItem.prominentForeground');
            case 'Idle':
            case 'Running': return undefined;
            case 'Waiting for Approval':
            case 'SigninRequired':
            case 'Unauthorized':
            case 'RateLimited': return new vscode.ThemeColor('statusBarItem.warningForeground');
            case 'Failed':
            case 'Error': return new vscode.ThemeColor('statusBarItem.errorForeground');
            case 'Done': return new vscode.ThemeColor('charts.green');
            case 'Disabled': return new vscode.ThemeColor('disabledForeground');
            default: return new vscode.ThemeColor('statusBarItem.warningForeground');
        }
    };
    const copilotTooltip = (info: any) => {
        if (!info) return 'GitHub Copilot status: Unknown';
        let t = 'GitHub Copilot (This Window)\n';
        t += `Status: ${info.status}\n`;
        t += `Installed: ${info.isInstalled ? 'Yes' : 'No'}\n`;
        if (info.isInstalled) {
            t += `Active: ${info.isActive ? 'Yes' : 'No'}\n`;
            if (info.version) t += `Version: ${info.version}\n`;
            if (info.detailHint) t += `Hint: ${info.detailHint}\n`;
            if (info.error) t += `Error: ${info.error}\n`;
            if (info.lastActivity) t += `Last Activity: ${new Date(info.lastActivity).toLocaleString()}\n`;
        }
        t += '\nClick for full Copilot status summary.';
        return t;
    };
    const updateCopilotBar = (info: any) => {
        if (!info) {
            copilotStatusBar.text = 'Copilot: $(question)';
            copilotStatusBar.tooltip = 'Copilot status unknown';
            copilotStatusBar.color = new vscode.ThemeColor('statusBarItem.warningForeground');
        } else {
            copilotStatusBar.text = `${copilotIcon(info.status)} Copilot`;
            copilotStatusBar.tooltip = copilotTooltip(info);
            copilotStatusBar.color = copilotColor(info.status);
        }
        copilotStatusBar.show();
    };
    copilotStatusService.onStatusChange(updateCopilotBar);
    copilotStatusService.start();
    updateCopilotBar(copilotStatusService.getCurrentStatus());
    context.subscriptions.push(copilotStatusBar);
    context.subscriptions.push({ dispose: () => copilotStatusService.dispose() });

    // Aggregated Copilot status bar (all instances)
    const aggStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    aggStatusBar.name = 'Copilot Aggregate';
    aggStatusBar.command = 'bot-boss.showAggregatedCopilotStatus';
    const refreshAggregate = async () => {
        const instances = await VSCodeInstanceService.getInstance().getVSCodeInstances();
        const copilotInfos = instances.filter(i => i.copilotInfo).map(i => i.copilotInfo!);
        if (copilotInfos.length === 0) {
            aggStatusBar.text = 'Copilot(All): $(question)';
            aggStatusBar.tooltip = 'No Copilot data from other instances';
            aggStatusBar.show();
            return;
        }
        const summary = summarizeCopilotStatuses(copilotInfos);
        const worst = summary.worstStatus;
        const sev = summary.worstSeverity;
        const icon = sev >= 5 ? '$(error)' : sev >= 4 ? '$(warning)' : sev >= 3 ? '$(gear)' : sev >= 2 ? '$(sync~spin)' : sev >= 1 ? '$(circle-slash)' : '$(pass-filled)';
        aggStatusBar.text = `${icon} Copilot(${summary.total})`;
        const lines: string[] = [];
        lines.push('Aggregated GitHub Copilot Status');
        lines.push(`Total Instances: ${summary.total}`);
        lines.push(`Worst Status: ${worst}`);
        lines.push('');
        Object.keys(summary.counts).sort().forEach(k => lines.push(`${k}: ${summary.counts[k]}`));
        lines.push('\nClick for detailed aggregated view.');
        aggStatusBar.tooltip = lines.join('\n');
        aggStatusBar.show();
    };
    // Refresh aggregate periodically (reuse instance refresh cadence)
    setInterval(refreshAggregate, 15000);
    refreshAggregate();
    context.subscriptions.push(aggStatusBar);

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
                const iconMap: Record<string, string> = {
                    Initializing: '🟤', Idle: '🟢', Running: '🟢', Generating: '⚙️', 'Waiting for Approval': '🟡', SigninRequired: '🔐', Unauthorized: '🚫', RateLimited: '⏳', Failed: '🔴', Error: '🛑', Done: '✅', Disabled: '⚫', Unknown: '❓'
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

        const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    });

    // Command: Show GitHub service status
    const gitHubStatusCommand = vscode.commands.registerCommand('bot-boss.showGitHubStatus', async () => {
        const cfg = vscode.workspace.getConfiguration('bot-boss');
        if (!cfg.get<boolean>('githubStatus.enable')) {
            vscode.window.showInformationMessage('GitHub status feature disabled via settings.');
            return;
        }
        try {
            const statusService = GitHubStatusService.getInstance();
            const report = await statusService.getStatusReport();

            const doc = await vscode.workspace.openTextDocument({
                content: report,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch GitHub status: ${error}`);
        }
    });

    // Command: Show quick GitHub status in status bar
    const quickGitHubStatusCommand = vscode.commands.registerCommand('bot-boss.quickGitHubStatus', async () => {
        const cfg = vscode.workspace.getConfiguration('bot-boss');
        if (!cfg.get<boolean>('githubStatus.enable')) {
            vscode.window.showInformationMessage('GitHub status feature disabled via settings.');
            return;
        }
        try {
            const statusService = GitHubStatusService.getInstance();
            const overall = await statusService.getOverallStatus();
            const activeIncidents = await statusService.getActiveIncidents();

            let message = `GitHub Status: ${overall.icon} ${overall.description}`;
            if (activeIncidents.length > 0) {
                message += ` (${activeIncidents.length} active incident${activeIncidents.length === 1 ? '' : 's'})`;
            }

            vscode.window.showInformationMessage(message, 'View Details').then(selection => {
                if (selection === 'View Details') {
                    vscode.commands.executeCommand('bot-boss.showGitHubStatus');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch GitHub status: ${error}`);
        }
    });

    // Command: Clear GitHub status cache
    const clearGitHubCacheCommand = vscode.commands.registerCommand('bot-boss.clearGitHubCache', async () => {
        const cfg = vscode.workspace.getConfiguration('bot-boss');
        if (!cfg.get<boolean>('githubStatus.enable')) {
            vscode.window.showInformationMessage('GitHub status feature disabled via settings.');
            return;
        }
        const statusService = GitHubStatusService.getInstance();
        statusService.clearCache();
        vscode.window.showInformationMessage('GitHub status cache cleared. Next status request will fetch fresh data.');
    });

    // Command: Open in Editor - opens the extension interface as a tab
    const openInEditorCommand = vscode.commands.registerCommand('bot-boss.openInEditor', () => {
        BotBossEditorPanel.createOrShow(context.extensionUri);
    });

    context.subscriptions.push(copilotStatusCommand);
    context.subscriptions.push(gitHubStatusCommand);
    context.subscriptions.push(quickGitHubStatusCommand);
    context.subscriptions.push(clearGitHubCacheCommand);
    context.subscriptions.push(openInEditorCommand);
    context.subscriptions.push({
        dispose: () => clearInterval(autoRefreshInterval)
    });

    // Command: Copilot history
    const copilotHistoryCmd = vscode.commands.registerCommand('bot-boss.showCopilotHistory', async () => {
        const hist = copilotStatusService.getHistory();
        if (!hist.length) {
            vscode.window.showInformationMessage('No Copilot history yet.');
            return;
        }
        const lines: string[] = [];
        lines.push('# Copilot Status History (Current Window)');
        lines.push(`Generated: ${new Date().toLocaleString()}`); lines.push('');
        hist.slice().reverse().forEach(h => {
            lines.push(`- ${new Date(h.timestamp).toLocaleTimeString()} • ${h.status}${h.detailHint ? ' – ' + h.detailHint : ''}${h.error ? ' (Error: ' + h.error + ')' : ''}`);
        });
        const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    });
    context.subscriptions.push(copilotHistoryCmd);

    // Command: Aggregated Copilot status (detailed)
    const aggCopilotCmd = vscode.commands.registerCommand('bot-boss.showAggregatedCopilotStatus', async () => {
        await provider.refreshInstances();
        const instances = (provider as any).instances as VSCodeInstance[];
        const infos = instances.filter(i => i.copilotInfo).map(i => i.copilotInfo!);
        const summary = summarizeCopilotStatuses(infos);
        const lines: string[] = [];
        lines.push('# Aggregated Copilot Status');
        lines.push(`Generated: ${new Date().toLocaleString()}`); lines.push('');
        lines.push(`Instances with data: ${summary.total}`);
        lines.push(`Worst Status: ${summary.worstStatus}`); lines.push('');
        lines.push('Status Counts:');
        Object.keys(summary.counts).sort().forEach(k => lines.push(`- ${k}: ${summary.counts[k]}`));
        lines.push('\nPer Instance:');
        for (const inst of instances) {
            const c = inst.copilotInfo;
            if (!c) { lines.push(`- ${inst.name}: (no data)`); continue; }
            lines.push(`- ${inst.name}: ${c.status}${c.version ? ' v' + c.version : ''}${c.detailHint ? ' – ' + c.detailHint : ''}`);
        }
        const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    });
    context.subscriptions.push(aggCopilotCmd);

    // Command: Try Copilot sign-in fallback
    const copilotSigninCmd = vscode.commands.registerCommand('bot-boss.tryCopilotSignin', async () => {
        const currentStatus = copilotStatusService.getCurrentStatus();
        if (!currentStatus || (currentStatus.status !== 'SigninRequired' && currentStatus.status !== 'Unauthorized')) {
            vscode.window.showInformationMessage(`Current Copilot status is "${currentStatus?.status || 'Unknown'}". Sign-in may not be needed.`);
            return;
        }

        const knownCommands = [
            'github.copilot.signIn',
            'github.copilot.signin',
            'github.copilot.auth.signin',
            'github.copilot.loginWithGitHub',
            'github.copilot.openSetup',
            'github.copilot.configure'
        ];

        let success = false;
        const results: string[] = [];

        for (const cmd of knownCommands) {
            try {
                await vscode.commands.executeCommand(cmd);
                results.push(`✅ ${cmd}: executed successfully`);
                success = true;
                break; // Stop on first success
            } catch (error) {
                results.push(`❌ ${cmd}: ${error instanceof Error ? error.message : 'failed'}`);
            }
        }

        if (!success) {
            // Try opening GitHub Copilot extension page as fallback
            try {
                await vscode.commands.executeCommand('workbench.extensions.search', '@id:github.copilot');
                results.push('✅ Opened Copilot extension page as fallback');
                success = true;
            } catch {
                results.push('❌ Could not open extension page');
            }
        }

        const report = [
            '# Copilot Sign-In Attempt Report',
            `Generated: ${new Date().toLocaleString()}`,
            `Current Status: ${currentStatus.status}`,
            '',
            'Command Attempts:',
            ...results,
            '',
            success ? 'At least one sign-in method was attempted. Check Copilot status in a moment.' :
                'All sign-in attempts failed. Try manually: Extensions → GitHub Copilot → Sign In'
        ].join('\n');

        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });

        // Refresh status after a brief delay
        setTimeout(() => {
            copilotStatusService.refresh();
        }, 2000);
    });
    context.subscriptions.push(copilotSigninCmd);

    // Command: Test Copilot activity detection
    const testCopilotActivity = vscode.commands.registerCommand('bot-boss.testCopilotActivity', async () => {
        vscode.window.showInformationMessage('Testing Copilot activity detection...');

        // Force immediate refresh before test
        await copilotStatusService.refresh();
        const beforeStatus = copilotStatusService.getCurrentStatus();

        // Try to trigger Copilot activity
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // Insert some code that might trigger Copilot
            const position = editor.selection.active;
            await editor.edit(editBuilder => {
                editBuilder.insert(position, '// TODO: ');
            });

            // Try to trigger completion
            try {
                await vscode.commands.executeCommand('editor.action.triggerSuggest');
            } catch { }

            // Wait a moment then check status
            setTimeout(async () => {
                await copilotStatusService.refresh();
                const afterStatus = copilotStatusService.getCurrentStatus();

                const report = [
                    '# Copilot Activity Test Report',
                    `Generated: ${new Date().toLocaleString()}`,
                    '',
                    `Before: ${beforeStatus?.status || 'Unknown'}`,
                    `After: ${afterStatus?.status || 'Unknown'}`,
                    '',
                    beforeStatus?.status !== afterStatus?.status ?
                        '✅ Status changed - detection is working!' :
                        '⚠️ Status unchanged - Copilot may truly be idle or detection needs improvement'
                ].join('\n');

                const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
                await vscode.window.showTextDocument(doc, { preview: true });
            }, 1000);
        } else {
            vscode.window.showWarningMessage('Open a file first to test Copilot activity detection.');
        }
    });
    context.subscriptions.push(testCopilotActivity);

    // Command: Debug Copilot Chat monitoring
    const debugCopilotChat = vscode.commands.registerCommand('bot-boss.debugCopilotChat', async () => {
        vscode.window.showInformationMessage('Debugging Copilot Chat monitoring...');

        // Run the debug method
        copilotStatusService.debugCopilotExtensions();

        // Get current statuses
        const status = copilotStatusService.getCurrentStatus();
        const chatStatus = copilotStatusService.getCurrentChatStatus();

        // Force a refresh to get latest info
        await copilotStatusService.refresh();
        const refreshedStatus = copilotStatusService.getCurrentStatus();

        const report = [
            '# Copilot Chat Debug Report',
            '',
            '## Current Status',
            `- Main Status: ${status?.status || 'unknown'}`,
            `- Is Installed: ${status?.isInstalled}`,
            `- Is Active: ${status?.isActive}`,
            `- Detail: ${status?.detailHint || 'none'}`,
            '',
            '## Chat Status',
            `- Chat Active: ${chatStatus?.isActive || false}`,
            `- Chat State: ${chatStatus?.state || 'unknown'}`,
            `- Chat Responding: ${chatStatus?.isResponding || false}`,
            `- Last Activity: ${chatStatus?.lastChatActivity || 'none'}`,
            '',
            '## After Refresh',
            `- Status: ${refreshedStatus?.status}`,
            `- Chat Status: ${(refreshedStatus as any)?.chat?.state || 'unknown'}`,
            `- Chat Responding: ${(refreshedStatus as any)?.chat?.isResponding || false}`,
            '',
            '## Instructions',
            '1. Open VS Code Developer Console (Help > Toggle Developer Tools)',
            '2. Look for [BotBoss] log messages in the console',
            '3. Start a Copilot Chat conversation',
            '4. Run this command again to see changes',
            '5. Watch for status changes to "Generating" when chat is active',
            '',
            '## Troubleshooting',
            'If chat status shows as "idle" even when active:',
            '- Check console for extension export information',
            '- Verify Copilot Chat extension is installed and active',
            '- Try different types of chat interactions (inline, chat panel, etc.)',
            '',
            '*Check VS Code Developer Console for detailed logs*'
        ].join('\n');

        const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    });
    context.subscriptions.push(debugCopilotChat);

    // Command: refresh Copilot view
    const refreshCopilotView = vscode.commands.registerCommand('bot-boss.refreshCopilotView', () => {
        // Force immediate refresh
        (copilotTree as any).refresh?.();
    });
    context.subscriptions.push(refreshCopilotView);

    // Debug Commands
    const showDebugInfo = vscode.commands.registerCommand('bot-boss.showDebugInfo', async () => {
        logger.info('DebugCommands', 'Generating debug information report');

        const debugInfo = [
            '# Bot Boss Debug Information',
            `Generated: ${new Date().toLocaleString()}`,
            '',
            '## Configuration',
            `Debug Enabled: ${vscode.workspace.getConfiguration('bot-boss').get('debug.enabled')}`,
            `Log Level: ${vscode.workspace.getConfiguration('bot-boss').get('debug.logLevel')}`,
            `Environment Debug: ${process.env.BOT_BOSS_DEBUG || 'not set'}`,
            '',
            '## Extension State',
            `Extension Active: true`,
            `VS Code Version: ${vscode.version}`,
            `Extension Version: ${context.extension.packageJSON.version}`,
            '',
            '## Services Status',
            `VSCodeInstanceService: ${VSCodeInstanceService.getInstance() ? 'initialized' : 'not initialized'}`,
            `SharedInstanceManager: ${SharedInstanceManager.getInstance() ? 'initialized' : 'not initialized'}`,
            `CopilotStatusService: ${copilotStatusService ? 'initialized' : 'not initialized'}`,
            '',
            '## Recent Extension Activity',
            'Check the Bot Boss Debug output channel for detailed logs.',
            '',
            '## Commands Available',
            '- bot-boss.enableDebugMode: Enable debug logging',
            '- bot-boss.clearDebugLog: Clear debug output',
            '- bot-boss.debugCopilotRaw: Debug Copilot status',
            '- bot-boss.debugDetection: Debug instance detection',
            '- bot-boss.debugCopilotChat: Debug Copilot Chat monitoring'
        ].join('\n');

        const doc = await vscode.workspace.openTextDocument({
            content: debugInfo,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: true });

        // Also show the debug output
        logger.show();
    });

    const enableDebugMode = vscode.commands.registerCommand('bot-boss.enableDebugMode', async () => {
        const config = vscode.workspace.getConfiguration('bot-boss');
        await config.update('debug.enabled', true, vscode.ConfigurationTarget.Global);
        await config.update('debug.logLevel', 'debug', vscode.ConfigurationTarget.Global);

        logger.info('DebugCommands', 'Debug mode enabled');
        vscode.window.showInformationMessage('Bot Boss debug mode enabled. Check the Bot Boss Debug output channel.');
        logger.show();
    });

    const clearDebugLog = vscode.commands.registerCommand('bot-boss.clearDebugLog', () => {
        logger.clear();
        logger.info('DebugCommands', 'Debug log cleared');
        vscode.window.showInformationMessage('Bot Boss debug log cleared.');
    });

    const debugExtensionHost = vscode.commands.registerCommand('bot-boss.debugExtensionHost', async () => {
        logger.info('DebugCommands', 'Gathering extension host information');

        const extensionHostInfo = [
            '# Extension Host Debug Information',
            `Generated: ${new Date().toLocaleString()}`,
            '',
            '## VS Code Environment',
            `Version: ${vscode.version}`,
            `Language: ${vscode.env.language}`,
            `App Name: ${vscode.env.appName}`,
            `Session ID: ${vscode.env.sessionId}`,
            `Machine ID: ${vscode.env.machineId.substring(0, 8)}...`,
            `Remote Name: ${vscode.env.remoteName || 'Not remote'}`,
            '',
            '## Workspace Information',
            `Workspace Folders: ${vscode.workspace.workspaceFolders?.length || 0}`,
            `Workspace Name: ${vscode.workspace.name || 'Unnamed'}`,
            '',
            '## Extension Information',
            `Extension ID: ${context.extension.id}`,
            `Extension Path: ${context.extension.extensionPath}`,
            `Extension Kind: ${context.extension.extensionKind}`,
            `Extension Mode: ${context.extensionMode}`,
            '',
            '## Active Extensions',
            ...vscode.extensions.all
                .filter(ext => ext.isActive)
                .slice(0, 10)
                .map(ext => `- ${ext.id} (${ext.packageJSON.version})`),
            '',
            '## Memory Usage',
            `Process Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
            `Process Uptime: ${Math.round(process.uptime())}s`,
            '',
            '## Debug Output',
            'Check the Bot Boss Debug output channel for detailed logs.'
        ].join('\n');

        logger.debug('DebugCommands', 'Extension host info', {
            vsCodeVersion: vscode.version,
            extensionCount: vscode.extensions.all.length,
            activeExtensions: vscode.extensions.all.filter(ext => ext.isActive).length,
            workspaceFolders: vscode.workspace.workspaceFolders?.length || 0
        });

        const doc = await vscode.workspace.openTextDocument({
            content: extensionHostInfo,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
        logger.show();
    });

    const testAllFeatures = vscode.commands.registerCommand('bot-boss.testAllFeatures', async () => {
        logger.info('DebugCommands', 'Starting comprehensive feature test');

        try {
            const testResults: string[] = [];
            testResults.push('# Bot Boss Feature Test Results');
            testResults.push(`Started: ${new Date().toLocaleString()}`);
            testResults.push('');

            // Test 1: VS Code Instance Detection
            logger.debug('DebugCommands', 'Testing VS Code instance detection');
            try {
                const instances = await VSCodeInstanceService.getInstance().getVSCodeInstances();
                testResults.push(`✅ Instance Detection: Found ${instances.length} instances`);
                logger.debug('DebugCommands', 'Instance detection success', { count: instances.length });
            } catch (error) {
                testResults.push(`❌ Instance Detection: ${error}`);
                logger.error('DebugCommands', 'Instance detection failed', error);
            }

            // Test 2: Copilot Status
            logger.debug('DebugCommands', 'Testing Copilot status detection');
            try {
                const copilotInfo = await VSCodeInstanceService.getInstance().getCopilotInfo();
                testResults.push(`✅ Copilot Status: ${copilotInfo.status} (Installed: ${copilotInfo.isInstalled})`);
                logger.debug('DebugCommands', 'Copilot status success', copilotInfo);
            } catch (error) {
                testResults.push(`❌ Copilot Status: ${error}`);
                logger.error('DebugCommands', 'Copilot status failed', error);
            }

            // Test 3: Shared Instance Manager
            logger.debug('DebugCommands', 'Testing shared instance manager');
            try {
                await SharedInstanceManager.getInstance().registerCurrentInstance();
                const allInstances = await SharedInstanceManager.getInstance().getAllInstances();
                testResults.push(`✅ Shared Manager: Registered, ${allInstances.length} total instances`);
                logger.debug('DebugCommands', 'Shared manager success', { totalInstances: allInstances.length });
            } catch (error) {
                testResults.push(`❌ Shared Manager: ${error}`);
                logger.error('DebugCommands', 'Shared manager failed', error);
            }

            // Test 4: Configuration
            logger.debug('DebugCommands', 'Testing configuration');
            try {
                const config = vscode.workspace.getConfiguration('bot-boss');
                const debugEnabled = config.get('debug.enabled');
                const pollInterval = config.get('copilot.pollIntervalMs');
                testResults.push(`✅ Configuration: Debug=${debugEnabled}, Poll=${pollInterval}ms`);
                logger.debug('DebugCommands', 'Configuration success', { debugEnabled, pollInterval });
            } catch (error) {
                testResults.push(`❌ Configuration: ${error}`);
                logger.error('DebugCommands', 'Configuration failed', error);
            }

            // Test 5: Commands
            logger.debug('DebugCommands', 'Testing command availability');
            try {
                const commands = await vscode.commands.getCommands();
                const botBossCommands = commands.filter(cmd => cmd.startsWith('bot-boss.'));
                testResults.push(`✅ Commands: ${botBossCommands.length} Bot Boss commands available`);
                logger.debug('DebugCommands', 'Commands success', { commandCount: botBossCommands.length });
            } catch (error) {
                testResults.push(`❌ Commands: ${error}`);
                logger.error('DebugCommands', 'Commands failed', error);
            }

            testResults.push('');
            testResults.push(`Completed: ${new Date().toLocaleString()}`);
            testResults.push('');
            testResults.push('## Detailed Logs');
            testResults.push('Check the Bot Boss Debug output channel for detailed execution logs.');

            const doc = await vscode.workspace.openTextDocument({
                content: testResults.join('\n'),
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, { preview: true });

            logger.info('DebugCommands', 'Feature test completed');
            logger.show();

        } catch (error) {
            logger.error('DebugCommands', 'Feature test failed', error);
            vscode.window.showErrorMessage(`Feature test failed: ${error}`);
        }
    });

    context.subscriptions.push(showDebugInfo);
    context.subscriptions.push(enableDebugMode);
    context.subscriptions.push(clearDebugLog);
    context.subscriptions.push(debugExtensionHost);
    context.subscriptions.push(testAllFeatures);

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
