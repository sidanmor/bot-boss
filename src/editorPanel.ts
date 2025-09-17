import * as vscode from 'vscode';
import * as path from 'path';
import { VSCodeInstanceService, VSCodeInstance } from './vscodeInstanceService';
import { SharedInstanceManager } from './sharedInstanceManager';
import { GitHubStatusService } from './githubStatusService';

export class BotBossEditorPanel {
    public static currentPanel: BotBossEditorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _instanceService: VSCodeInstanceService;
    private _sharedManager: SharedInstanceManager;
    private _githubService: GitHubStatusService;
    private _refreshInterval: NodeJS.Timeout | undefined;

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (BotBossEditorPanel.currentPanel) {
            BotBossEditorPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'botBossEditor',
            'Bot Boss - VS Code Manager',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        BotBossEditorPanel.currentPanel = new BotBossEditorPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;

        // Initialize services
        this._instanceService = VSCodeInstanceService.getInstance();
        this._sharedManager = SharedInstanceManager.getInstance();
        this._githubService = GitHubStatusService.getInstance();

        // Set the webview's initial html content
        this._update();

        // Start auto-refresh for real data
        this._startAutoRefresh();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'refreshInstances':
                        vscode.commands.executeCommand('bot-boss.refreshInstances');
                        return;
                    case 'focusInstance':
                        vscode.commands.executeCommand('bot-boss.focusInstance', { pid: message.pid });
                        return;
                    case 'showWorkspaceInfo':
                        vscode.commands.executeCommand('bot-boss.openWorkspaceInfo', message.instance);
                        return;
                    case 'showCopilotStatus':
                        vscode.commands.executeCommand('bot-boss.showCopilotStatus');
                        return;
                    case 'showGitHubStatus':
                        vscode.commands.executeCommand('bot-boss.showGitHubStatus');
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        BotBossEditorPanel.currentPanel = undefined;

        // Stop auto-refresh
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = undefined;
        }

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _startAutoRefresh() {
        // Initial load
        this._refreshInstances();
        
        // Set up auto-refresh every 10 seconds
        this._refreshInterval = setInterval(() => {
            this._refreshInstances();
        }, 10000);
    }

    private async _refreshInstances() {
        try {
            const instances = await this._instanceService.getVSCodeInstances();
            
            // Send real data to webview
            this._panel.webview.postMessage({
                command: 'updateInstances',
                instances: instances,
                timestamp: new Date().toLocaleTimeString()
            });
        } catch (error) {
            console.error('Error refreshing instances in editor panel:', error);
            
            // Send error to webview
            this._panel.webview.postMessage({
                command: 'error',
                message: `Failed to refresh instances: ${error}`
            });
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'Bot Boss - VS Code Manager';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bot Boss - VS Code Manager</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            font-weight: var(--vscode-font-weight);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            line-height: 1.4;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .title {
            font-size: 1.5em;
            font-weight: bold;
            color: var(--vscode-titleBar-activeForeground);
        }

        .refresh-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
        }

        .refresh-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .status-bar {
            background: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #4CAF50;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }

        .instances-container {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 0;
            overflow: hidden;
        }

        .instances-header {
            background: var(--vscode-sideBarSectionHeader-background);
            color: var(--vscode-sideBarSectionHeader-foreground);
            padding: 12px 16px;
            font-weight: bold;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .instance-item {
            border-bottom: 1px solid var(--vscode-panel-border);
            transition: background-color 0.2s;
        }

        .instance-item:last-child {
            border-bottom: none;
        }

        .instance-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .instance-header {
            padding: 12px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .instance-title {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }

        .instance-icon {
            font-size: 1.1em;
        }

        .instance-name {
            font-weight: 500;
        }

        .instance-info {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }

        .instance-actions {
            display: flex;
            gap: 8px;
        }

        .action-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.8em;
        }

        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .instance-details {
            padding: 0 16px 12px 16px;
            background: var(--vscode-editor-background);
            display: none;
        }

        .instance-details.expanded {
            display: block;
        }

        .detail-section {
            margin-bottom: 12px;
        }

        .detail-title {
            font-weight: bold;
            margin-bottom: 4px;
            color: var(--vscode-settings-headerForeground);
        }

        .detail-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
            font-size: 0.9em;
        }

        .detail-icon {
            width: 16px;
            text-align: center;
        }

        .no-instances {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .loading {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .error {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 12px 16px;
            border-radius: 4px;
            margin-bottom: 20px;
        }

        .quick-actions {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .quick-action-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .quick-action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .status-badge {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.75em;
            font-weight: bold;
        }

        .status-idle { background: #4CAF50; color: white; }
        .status-generating { background: #2196F3; color: white; }
        .status-error { background: #f44336; color: white; }
        .status-warning { background: #ff9800; color: white; }
        .status-disabled { background: #757575; color: white; }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🤖 Bot Boss - VS Code Instance Manager</div>
        <button class="refresh-btn" onclick="refreshInstances()">🔄 Refresh</button>
    </div>

    <div class="status-bar">
        <div class="status-indicator"></div>
        <span id="statusText">Loading instances...</span>
        <span id="lastUpdate"></span>
    </div>

    <div class="quick-actions">
        <button class="quick-action-btn" onclick="showCopilotStatus()">
            <span>🤖</span> Copilot Status
        </button>
        <button class="quick-action-btn" onclick="showGitHubStatus()">
            <span>🌐</span> GitHub Status
        </button>
        <button class="quick-action-btn" onclick="refreshInstances()">
            <span>🔄</span> Refresh All
        </button>
    </div>

    <div class="instances-container">
        <div class="instances-header">VS Code Instances</div>
        <div id="instancesList">
            <div class="loading">Loading VS Code instances...</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let instances = [];
        let expandedInstances = new Set();

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateInstances':
                    instances = message.instances || [];
                    updateStatus(message.timestamp);
                    renderInstances();
                    break;
                case 'error':
                    showError(message.message);
                    break;
            }
        });

        function refreshInstances() {
            document.getElementById('statusText').textContent = 'Refreshing...';
            vscode.postMessage({ command: 'refreshInstances' });
        }

        function updateStatus(timestamp) {
            document.getElementById('statusText').textContent = 'Live Monitor (' + instances.length + ' instance' + (instances.length === 1 ? '' : 's') + ')';
            document.getElementById('lastUpdate').textContent = 'Updated: ' + (timestamp || new Date().toLocaleTimeString());
        }

        function showError(errorMessage) {
            const container = document.getElementById('instancesList');
            container.innerHTML = '<div class="error">Error: ' + errorMessage + '</div>';
            document.getElementById('statusText').textContent = 'Error loading instances';
        }

        function focusInstance(pid) {
            vscode.postMessage({ command: 'focusInstance', pid: pid });
        }

        function showWorkspaceInfo(instance) {
            vscode.postMessage({ command: 'showWorkspaceInfo', instance: instance });
        }

        function showCopilotStatus() {
            vscode.postMessage({ command: 'showCopilotStatus' });
        }

        function showGitHubStatus() {
            vscode.postMessage({ command: 'showGitHubStatus' });
        }

        function toggleInstanceDetails(pid) {
            if (expandedInstances.has(pid)) {
                expandedInstances.delete(pid);
            } else {
                expandedInstances.add(pid);
            }
            renderInstances();
        }

        function formatMemory(mb) {
            if (mb > 1024) {
                return (mb / 1024).toFixed(1) + ' GB';
            }
            return mb + ' MB';
        }

        function getCopilotStatusBadge(copilotInfo) {
            if (!copilotInfo) return '<span class="status-badge status-disabled">Unknown</span>';
            
            if (!copilotInfo.isInstalled) {
                return '<span class="status-badge status-disabled">Not Installed</span>';
            }
            
            if (!copilotInfo.isActive) {
                return '<span class="status-badge status-disabled">Inactive</span>';
            }
            
            const status = copilotInfo.status;
            let className = 'status-idle';
            
            if (status === 'Generating') className = 'status-generating';
            else if (status === 'Error' || status === 'Failed') className = 'status-error';
            else if (status === 'SigninRequired' || status === 'Unauthorized' || status === 'RateLimited') className = 'status-warning';
            else if (status === 'Disabled') className = 'status-disabled';
            
            return '<span class="status-badge ' + className + '">' + status + '</span>';
        }

        function renderInstances() {
            const container = document.getElementById('instancesList');
            
            if (instances.length === 0) {
                container.innerHTML = '<div class="no-instances">No VS Code instances found</div>';
                return;
            }

            const html = instances.map(instance => {
                const isExpanded = expandedInstances.has(instance.pid);
                const workspaceName = instance.workspacePath ? instance.workspacePath.split('\\\\').pop() || instance.workspacePath.split('/').pop() : 'No workspace';
                
                let gitInfo = '';
                if (instance.gitInfo && instance.gitInfo.isGitRepo) {
                    gitInfo = '<div class="detail-section">' +
                        '<div class="detail-title">Git Information</div>' +
                        (instance.gitInfo.branch ? '<div class="detail-item"><span class="detail-icon">🌿</span>Branch: ' + instance.gitInfo.branch + (instance.gitInfo.hasChanges ? ' (*)' : '') + '</div>' : '') +
                        (instance.gitInfo.remoteUrl ? '<div class="detail-item"><span class="detail-icon">🌐</span>Remote: ' + instance.gitInfo.remoteUrl.replace('https://', '').replace('.git', '') + '</div>' : '') +
                        (instance.gitInfo.lastCommit ? '<div class="detail-item"><span class="detail-icon">📝</span>Last: ' + instance.gitInfo.lastCommit + '</div>' : '') +
                        (instance.gitInfo.ahead || instance.gitInfo.behind ? '<div class="detail-item"><span class="detail-icon">🔄</span>Sync: ' + (instance.gitInfo.ahead ? '↑' + instance.gitInfo.ahead : '') + (instance.gitInfo.behind ? '↓' + instance.gitInfo.behind : '') + '</div>' : '') +
                        '</div>';
                }

                return '<div class="instance-item">' +
                    '<div class="instance-header" onclick="toggleInstanceDetails(' + instance.pid + ')">' +
                        '<div class="instance-title">' +
                            '<span class="instance-icon">🪟</span>' +
                            '<div>' +
                                '<div class="instance-name">' + instance.name + '</div>' +
                                '<div class="instance-info">' + workspaceName + ' • ' + formatMemory(instance.memory) + ' • PID: ' + instance.pid + (instance.uptime ? ' • ' + instance.uptime : '') + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="instance-actions" onclick="event.stopPropagation()">' +
                            '<button class="action-btn" onclick="focusInstance(' + instance.pid + ')" title="Open Workspace">📂 Open</button>' +
                            '<button class="action-btn" onclick="showWorkspaceInfo(' + JSON.stringify(instance).replace(/"/g, '&quot;') + ')" title="Show Details">ℹ️ Info</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="instance-details ' + (isExpanded ? 'expanded' : '') + '">' +
                        '<div class="detail-section">' +
                            '<div class="detail-title">System Information</div>' +
                            '<div class="detail-item"><span class="detail-icon">🆔</span>Process ID: ' + instance.pid + '</div>' +
                            '<div class="detail-item"><span class="detail-icon">💾</span>Memory: ' + formatMemory(instance.memory) + '</div>' +
                            (instance.cpu > 0 ? '<div class="detail-item"><span class="detail-icon">⚡</span>CPU: ' + instance.cpu.toFixed(1) + '%</div>' : '') +
                            (instance.uptime ? '<div class="detail-item"><span class="detail-icon">⏱️</span>Uptime: ' + instance.uptime + '</div>' : '') +
                            (instance.workspacePath ? '<div class="detail-item"><span class="detail-icon">📁</span>Path: ' + instance.workspacePath + '</div>' : '') +
                        '</div>' +
                        gitInfo +
                        '<div class="detail-section">' +
                            '<div class="detail-title">GitHub Copilot</div>' +
                            '<div class="detail-item">' +
                                '<span class="detail-icon">🤖</span>' +
                                'Status: ' + getCopilotStatusBadge(instance.copilotInfo) +
                                (instance.copilotInfo && instance.copilotInfo.version ? ' (v' + instance.copilotInfo.version + ')' : '') +
                            '</div>' +
                            (instance.copilotInfo && instance.copilotInfo.detailHint ? '<div class="detail-item"><span class="detail-icon">💡</span>' + instance.copilotInfo.detailHint + '</div>' : '') +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');

            container.innerHTML = html;
        }

        // Request initial data from extension
        refreshInstances();
    </script>
</body>
</html>`;
    }

    public updateInstances(instances: any[]) {
        // Send instances data to the webview
        this._panel.webview.postMessage({
            command: 'updateInstances',
            instances: instances
        });
    }
}
