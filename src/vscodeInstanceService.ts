import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { SharedInstanceManager } from './sharedInstanceManager';
import { GitHubStatusService } from './githubStatusService';

const execAsync = promisify(exec);

export interface GitInfo {
    branch?: string;
    isGitRepo: boolean;
    hasChanges?: boolean;
    remoteUrl?: string;
    lastCommit?: string;
    ahead?: number;
    behind?: number;
}

export interface CopilotInfo {
    isInstalled: boolean;
    isActive: boolean;
    /**
     * Expanded status set to communicate user action needs.
     * Legend / Guidance:
     *  - Initializing: Starting up / loading models (wait)
     *  - Idle: Ready but not currently generating (no action)
     *  - Generating: Producing a suggestion/completion (wait)
     *  - Waiting for Approval: Needs policy / org approval (review admin / policy settings)
     *  - SigninRequired: User must sign in (run Copilot sign-in command)
     *  - Unauthorized: Auth failed or insufficient permissions (re-auth required)
     *  - RateLimited: Too many requests (pause usage briefly)
     *  - Failed / Error: Fault condition (check logs / reload window)
     *  - Disabled: Extension installed but inactive / globally disabled
     *  - Done: Recently completed a generation task
     *  - Running: Generic active state (legacy fallback)
     *  - Unknown: Could not determine current state
     */
    status: 'Initializing' | 'Idle' | 'Generating' | 'Waiting for Approval' | 'SigninRequired' | 'Unauthorized' | 'RateLimited' | 'Failed' | 'Error' | 'Disabled' | 'Done' | 'Running' | 'Unknown';
    lastActivity?: string;
    version?: string;
    error?: string;
    detailHint?: string; // Optional human-readable hint / action
}

export interface VSCodeInstance {
    pid: number;
    name: string;
    workspacePath?: string;
    windowTitle?: string;
    arguments: string[];
    cpu: number;
    memory: number;
    uptime?: string;
    gitInfo?: GitInfo;
    copilotInfo?: CopilotInfo;
}

export class VSCodeInstanceService {
    private static instance: VSCodeInstanceService;
    
    public static getInstance(): VSCodeInstanceService {
        if (!VSCodeInstanceService.instance) {
            VSCodeInstanceService.instance = new VSCodeInstanceService();
        }
        return VSCodeInstanceService.instance;
    }

    /**
     * Get all running VS Code instances using multiple methods
     */
    async getVSCodeInstances(): Promise<VSCodeInstance[]> {
        try {
            console.log('Starting VS Code instance detection...');
            
            // Method 1: Use SharedInstanceManager (primary method)
            const sharedManager = SharedInstanceManager.getInstance();
            const sharedInstances = await sharedManager.getAllInstances();
            console.log(`[BotBoss] VSCodeInstanceService: Shared file detection returned ${sharedInstances.length} instances`);
            
            // If shared file method returns instances, use it
            if (sharedInstances.length > 0) {
                console.log(`[BotBoss] VSCodeInstanceService: Using shared file data for ${sharedInstances.length} instances`);
                sharedInstances.forEach((instance, index) => {
                    console.log(`[BotBoss] VSCodeInstanceService: Instance ${index + 1}: ${instance.name} (PID: ${instance.pid}, Path: ${instance.workspacePath || 'No workspace'})`);
                });
                return sharedInstances;
            } else {
                console.log(`[BotBoss] VSCodeInstanceService: Shared file returned 0 instances, checking shared manager state...`);
            }
            
            // Fallback: Use process-based detection if shared file is empty
            console.log('Shared file is empty, falling back to process detection...');
            const processInstances = await this.getInstancesFromProcesses();
            console.log(`Process detection returned ${processInstances.length} instances`);
            
            // Method 2: Add current instance from VS Code API if not already included
            const currentInstance = await this.getCurrentInstanceFromAPI();
            if (currentInstance) {
                console.log(`Current instance from API: ${currentInstance.name} (PID: ${currentInstance.pid})`);
                // Check if current instance is already in the process list by PID
                const exists = processInstances.find(inst => inst.pid === currentInstance.pid);
                if (!exists) {
                    console.log('Adding current instance to list (not found in processes)');
                    processInstances.push(currentInstance);
                } else {
                    console.log('Current instance already found in process list - updating with API info');
                    // Update the existing instance with more accurate API information
                    const existingIndex = processInstances.findIndex(inst => inst.pid === currentInstance.pid);
                    if (existingIndex !== -1) {
                        // Merge API data with process data, preferring API data for current instance
                        processInstances[existingIndex] = {
                            ...processInstances[existingIndex],
                            ...currentInstance,
                            // Keep the better name if available
                            name: currentInstance.name || processInstances[existingIndex].name
                        };
                    }
                }
            }

            // Method 3: Try VS Code API method as backup for additional instances
            try {
                const apiInstances = await this.getInstancesFromVSCodeAPI();
                console.log(`VS Code API method found ${apiInstances.length} additional instances`);
                
                for (const apiInstance of apiInstances) {
                    const exists = processInstances.find(inst => 
                        inst.pid === apiInstance.pid || 
                        (inst.workspacePath && apiInstance.workspacePath && inst.workspacePath === apiInstance.workspacePath)
                    );
                    
                    if (!exists) {
                        console.log(`Adding additional instance from API: ${apiInstance.name}`);
                        processInstances.push(apiInstance);
                    }
                }
            } catch (apiError) {
                console.log('VS Code API method failed:', apiError);
            }

            // Deduplicate and clean up instances
            const uniqueInstances = this.deduplicateInstances(processInstances);

            console.log(`Final result: ${uniqueInstances.length} unique VS Code instances`);
            uniqueInstances.forEach((instance, index) => {
                console.log(`Instance ${index + 1}: ${instance.name} (PID: ${instance.pid}, Path: ${instance.workspacePath || 'No workspace'})`);
            });
            
            return uniqueInstances;
        } catch (error) {
            console.error('Error getting VS Code instances:', error);
            vscode.window.showErrorMessage(`Failed to get VS Code instances: ${error}`);
            return [];
        }
    }

    /**
     * Get current instance info using VS Code API
     */
    private async getInstancesFromVSCodeAPI(): Promise<VSCodeInstance[]> {
        const instances: VSCodeInstance[] = [];
        
        try {
            // Method 1: Current instance from VS Code API
            const currentInstance = await this.getCurrentInstanceFromAPI();
            if (currentInstance) {
                instances.push(currentInstance);
            }

            // Method 2: Try to find other instances through VS Code's user data directory
            const otherInstances = await this.getInstancesFromUserDataDir();
            instances.push(...otherInstances);

        } catch (error) {
            console.error('Error getting instances from VS Code API:', error);
        }

        return instances;
    }

    /**
     * Get current VS Code instance using the extension API
     */
    private async getCurrentInstanceFromAPI(): Promise<VSCodeInstance | null> {
        try {
            const currentInstance: VSCodeInstance = {
                pid: process.pid,
                name: 'VS Code - Current Instance',
                arguments: process.argv,
                cpu: 0,
                memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                uptime: this.calculateUptimeFromSeconds(process.uptime())
            };

            // Get workspace information (augment name rather than replace base token)
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const workspaceFolder = vscode.workspace.workspaceFolders[0];
                currentInstance.workspacePath = workspaceFolder.uri.fsPath;
                const folderName = path.basename(workspaceFolder.uri.fsPath);
                currentInstance.name = `VS Code - Current Instance (${folderName})`;

                // Get git info for current workspace
                currentInstance.gitInfo = await this.getGitInfo(workspaceFolder.uri.fsPath);
            } else if (vscode.workspace.name) {
                currentInstance.name = `VS Code - Current Instance (${vscode.workspace.name})`;
            }

            // Get GitHub Copilot info
            currentInstance.copilotInfo = await this.getCopilotInfo();

            return currentInstance;
        } catch (error) {
            console.error('Error getting current instance:', error);
            return null;
        }
    }

    /**
     * Try to find other VS Code instances by looking at user data directory
     */
    private async getInstancesFromUserDataDir(): Promise<VSCodeInstance[]> {
        const instances: VSCodeInstance[] = [];
        
        try {
            // VS Code stores instance information in the user data directory
            const userDataDir = this.getVSCodeUserDataDir();
            if (!userDataDir || !fs.existsSync(userDataDir)) {
                return instances;
            }

            // Look for running instances in logs or session files
            const logsDir = path.join(userDataDir, 'logs');
            if (fs.existsSync(logsDir)) {
                const logEntries = fs.readdirSync(logsDir);
                
                for (const entry of logEntries) {
                    const logPath = path.join(logsDir, entry);
                    if (fs.statSync(logPath).isDirectory()) {
                        // Each directory might represent a running instance
                        const rendererLogPath = path.join(logPath, 'renderer1.log');
                        if (fs.existsSync(rendererLogPath)) {
                            try {
                                const stats = fs.statSync(rendererLogPath);
                                const timeDiff = Date.now() - stats.mtime.getTime();
                                
                                // If log was modified recently (within 5 minutes), instance might be running
                                if (timeDiff < 5 * 60 * 1000) {
                                    // Try to extract instance info from log directory name or content
                                    const instanceInfo = await this.extractInstanceFromLogDir(logPath);
                                    if (instanceInfo) {
                                        instances.push(instanceInfo);
                                    }
                                }
                            } catch (logError) {
                                console.log('Error reading log file:', logError);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error getting instances from user data dir:', error);
        }

        return instances;
    }

    /**
     * Get VS Code user data directory
     */
    private getVSCodeUserDataDir(): string | null {
        const platform = os.platform();
        const homeDir = os.homedir();

        switch (platform) {
            case 'win32':
                return path.join(homeDir, 'AppData', 'Roaming', 'Code');
            case 'darwin':
                return path.join(homeDir, 'Library', 'Application Support', 'Code');
            case 'linux':
                return path.join(homeDir, '.config', 'Code');
            default:
                return null;
        }
    }

    /**
     * Extract instance information from a log directory
     */
    private async extractInstanceFromLogDir(logPath: string): Promise<VSCodeInstance | null> {
        try {
            // The log directory name sometimes contains timestamp or session info
            const dirName = path.basename(logPath);
            
            // Try to read recent log entries to get workspace info
            const mainLogPath = path.join(logPath, 'main.log');
            if (fs.existsSync(mainLogPath)) {
                const logContent = fs.readFileSync(mainLogPath, 'utf8');
                const lines = logContent.split('\n').slice(-100); // Read last 100 lines
                
                let workspacePath: string | undefined;
                let pid: number | undefined;

                for (const line of lines) {
                    // Look for workspace information in logs
                    if (line.includes('workspace:') || line.includes('folder:')) {
                        const match = line.match(/(?:workspace:|folder:)\s*([^\s]+)/);
                        if (match && match[1]) {
                            workspacePath = match[1];
                        }
                    }
                    
                    // Look for PID information
                    if (line.includes('pid:') || line.includes('process')) {
                        const match = line.match(/pid:?\s*(\d+)/);
                        if (match && match[1]) {
                            pid = parseInt(match[1]);
                        }
                    }
                }

                if (workspacePath || pid) {
                    const instance: VSCodeInstance = {
                        pid: pid || Math.floor(Math.random() * 10000), // Fallback to random PID
                        name: workspacePath ? `VS Code - ${path.basename(workspacePath)}` : `VS Code - ${dirName}`,
                        arguments: [],
                        cpu: 0,
                        memory: 0,
                        workspacePath
                    };

                    if (workspacePath && fs.existsSync(workspacePath)) {
                        instance.gitInfo = await this.getGitInfo(workspacePath);
                    }

                    return instance;
                }
            }
        } catch (error) {
            console.error('Error extracting from log dir:', error);
        }

        return null;
    }

    /**
     * Get instances from process detection (fallback method)
     */
    private async getInstancesFromProcesses(): Promise<VSCodeInstance[]> {
        try {
            const processes = await this.getVSCodeProcesses();
            console.log(`Raw processes found: ${processes.length}`);
            
            const instances: VSCodeInstance[] = [];

            for (const process of processes) {
                const instance = await this.extractInstanceInfo(process);
                if (instance) {
                    console.log(`Added instance: ${instance.name} (PID: ${instance.pid})`);
                    instances.push(instance);
                }
            }

            console.log(`Process detection found ${instances.length} instances`);
            return instances;
        } catch (error) {
            console.error('Error getting instances from processes:', error);
            return [];
        }
    }

    /**
     * Calculate uptime from seconds
     */
    private calculateUptimeFromSeconds(uptimeSeconds: number): string {
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    /**
     * Remove duplicate instances based on workspace path or PID
     */
    private deduplicateInstances(instances: VSCodeInstance[]): VSCodeInstance[] {
        const seen = new Set<string>();
        const unique: VSCodeInstance[] = [];

        for (const instance of instances) {
            // Create a unique key based on workspace path or PID
            const key = instance.workspacePath || `pid_${instance.pid}`;
            
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(instance);
            }
        }

        return unique;
    }

    /**
     * Get VS Code processes using improved detection methods
     */
    private async getVSCodeProcesses(): Promise<any[]> {
        try {
            // Method 1: Use PowerShell with better filtering
            const powershellInstances = await this.getVSCodeProcessesPowerShell();
            if (powershellInstances.length > 0) {
                return powershellInstances;
            }

            // Method 2: Use VS Code CLI if available
            const cliInstances = await this.getVSCodeInstancesFromCLI();
            if (cliInstances.length > 0) {
                return cliInstances;
            }

            // Method 3: Fallback to WMIC
            return await this.getVSCodeProcessesWMIC();
        } catch (error) {
            console.error('Error getting processes:', error);
            return [];
        }
    }

    /**
     * Use PowerShell with improved process detection
     */
    private async getVSCodeProcessesPowerShell(): Promise<any[]> {
        try {
            // Enhanced PowerShell command to detect all VS Code main windows
            const command = `
                # Get all Code processes
                $codeProcesses = Get-Process -Name "Code" -ErrorAction SilentlyContinue

                # Get process details with command lines
                $processDetails = foreach ($proc in $codeProcesses) {
                    try {
                        $wmiProcess = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
                        if ($wmiProcess) {
                            [PSCustomObject]@{
                                Id = $proc.Id
                                ProcessName = $proc.ProcessName
                                MainWindowTitle = $proc.MainWindowTitle
                                CommandLine = $wmiProcess.CommandLine
                                CPU = $proc.CPU
                                WorkingSet = $proc.WorkingSet
                                StartTime = $proc.StartTime
                                HasMainWindow = $proc.MainWindowTitle -ne "" -and $proc.MainWindowTitle -ne $null
                            }
                        }
                    } catch {
                        # Fallback for processes we can't get WMI info for
                        [PSCustomObject]@{
                            Id = $proc.Id
                            ProcessName = $proc.ProcessName
                            MainWindowTitle = $proc.MainWindowTitle
                            CommandLine = ""
                            CPU = $proc.CPU
                            WorkingSet = $proc.WorkingSet
                            StartTime = $proc.StartTime
                            HasMainWindow = $proc.MainWindowTitle -ne "" -and $proc.MainWindowTitle -ne $null
                        }
                    }
                }

                # Filter to main VS Code processes (not helper processes)
                $mainProcesses = $processDetails | Where-Object {
                    # Method 1: Process has a main window (most reliable)
                    if ($_.HasMainWindow) {
                        return $true
                    }
                    
                    # Method 2: Command line filtering for processes without windows
                    if ($_.CommandLine) {
                        $isHelper = ($_.CommandLine -like "*--type=renderer*") -or
                                   ($_.CommandLine -like "*--type=utility*") -or
                                   ($_.CommandLine -like "*--type=gpu-process*") -or
                                   ($_.CommandLine -like "*--type=extension-host*") -or
                                   ($_.CommandLine -like "*--type=crashpad-handler*") -or
                                   ($_.CommandLine -like "*--inspect-extensions*") -or
                                   ($_.CommandLine -like "*--ms-enable-electron-run-as-node*")
                        return -not $isHelper
                    }
                    
                    # Method 3: If no command line and no window, likely a helper process
                    return $false
                }

                # Convert to JSON
                if ($mainProcesses) {
                    $mainProcesses | ConvertTo-Json -Depth 3
                } else {
                    "[]"
                }
            `;
            
            const { stdout } = await execAsync(`powershell.exe -Command "${command}"`);
            
            if (!stdout.trim() || stdout.trim() === 'null' || stdout.trim() === '[]') {
                console.log('PowerShell: No VS Code main processes found');
                return [];
            }

            let result;
            try {
                result = JSON.parse(stdout);
                const processes = Array.isArray(result) ? result : [result];
                console.log(`PowerShell: Found ${processes.length} main VS Code processes`);
                return processes;
            } catch (parseError) {
                console.error('Failed to parse PowerShell output:', parseError);
                console.log('Raw PowerShell output:', stdout);
                return [];
            }
        } catch (error) {
            console.error('PowerShell method failed:', error);
            return [];
        }
    }

    /**
     * Try to use VS Code CLI to get running instances
     */
    private async getVSCodeInstancesFromCLI(): Promise<any[]> {
        try {
            // Try to use 'code --list-extensions' and parse running instances
            // This is a bit hacky but can work if VS Code CLI is available
            const { stdout } = await execAsync('code --status');
            
            // Parse the status output to get instance information
            if (stdout.includes('Version:')) {
                // VS Code is running and CLI is working
                // We can get current instance info from environment
                return [{
                    Id: process.pid,
                    ProcessName: 'Code',
                    MainWindowTitle: vscode.workspace.name || 'Visual Studio Code',
                    WorkingSet: process.memoryUsage().heapUsed,
                    CPU: 0,
                    StartTime: new Date(Date.now() - process.uptime() * 1000),
                    CommandLine: process.argv.join(' ')
                }];
            }
        } catch (error) {
            console.log('VS Code CLI method not available:', error);
        }
        return [];
    }

    /**
     * Fallback to WMIC for process detection
     */
    private async getVSCodeProcessesWMIC(): Promise<any[]> {
        try {
            // Use WMIC to get all Code.exe processes with command lines
            const { stdout } = await execAsync(`
                wmic process where "name='Code.exe'" get ProcessId,CommandLine,WorkingSetSize,CreationDate /format:csv
            `);
            
            const lines = stdout.split('\n').slice(1);
            const processes = [];
            
            for (const line of lines) {
                if (line.trim()) {
                    const parts = line.split(',');
                    if (parts.length >= 4) {
                        const commandLine = parts[2] || '';
                        const processId = parseInt(parts[4]) || 0;
                        
                        if (processId > 0) {
                            // Filter out helper processes
                            const isMainProcess = !commandLine.includes('--type=renderer') && 
                                                !commandLine.includes('--type=utility') &&
                                                !commandLine.includes('--type=gpu-process') &&
                                                !commandLine.includes('--type=extension-host') &&
                                                !commandLine.includes('--inspect-extensions');
                            
                            if (isMainProcess) {
                                processes.push({
                                    Id: processId,
                                    ProcessName: 'Code',
                                    MainWindowTitle: '',
                                    CommandLine: commandLine,
                                    WorkingSet: parseInt(parts[5]) || 0,
                                    CPU: 0,
                                    StartTime: parts[1] ? new Date(parts[1]) : null
                                });
                            }
                        }
                    }
                }
            }
            
            console.log(`WMIC found ${processes.length} main VS Code processes`);
            return processes;
        } catch (error) {
            console.error('WMIC method failed:', error);
            return [];
        }
    }

    /**
     * Extract detailed information from a process
     */
    private async extractInstanceInfo(process: any): Promise<VSCodeInstance | null> {
        try {
            const instance: VSCodeInstance = {
                pid: process.Id,
                name: `VS Code (PID: ${process.Id})`,
                arguments: [],
                cpu: process.CPU || 0,
                memory: this.parseMemory(process.WorkingSet),
                uptime: this.calculateUptime(process.StartTime),
                windowTitle: process.MainWindowTitle
            };

            // Priority 1: Use window title for workspace identification (most reliable for main windows)
            if (process.MainWindowTitle && process.MainWindowTitle !== 'Visual Studio Code' && process.MainWindowTitle.trim() !== '') {
                const workspaceFromTitle = this.extractWorkspaceFromTitle(process.MainWindowTitle);
                if (workspaceFromTitle) {
                    instance.workspacePath = workspaceFromTitle.path;
                    instance.name = `VS Code - ${workspaceFromTitle.name}`;
                    
                    // Get git information for the workspace
                    if (fs.existsSync(workspaceFromTitle.path)) {
                        instance.gitInfo = await this.getGitInfo(workspaceFromTitle.path);
                    }
                }
            }

            // Priority 2: Extract from command line if we don't have workspace from title
            if (!instance.workspacePath && process.CommandLine) {
                try {
                    instance.arguments = this.parseCommandLine(process.CommandLine);
                    
                    // Extract workspace path from arguments
                    const workspacePath = this.extractWorkspacePath(instance.arguments);
                    if (workspacePath && fs.existsSync(workspacePath)) {
                        instance.workspacePath = workspacePath;
                        instance.name = `VS Code - ${path.basename(workspacePath)}`;
                        
                        // Get git information for the workspace
                        instance.gitInfo = await this.getGitInfo(workspacePath);
                    }
                } catch (cmdError) {
                    console.log('Could not parse command line for process:', process.Id);
                }
            }

            // Priority 3: If still no workspace, try to get it from recent file arguments
            if (!instance.workspacePath && process.CommandLine) {
                const recentFile = this.extractRecentFileFromCommandLine(process.CommandLine);
                if (recentFile) {
                    const workspaceDir = path.dirname(recentFile);
                    if (fs.existsSync(workspaceDir)) {
                        instance.workspacePath = workspaceDir;
                        instance.name = `VS Code - ${path.basename(workspaceDir)}`;
                        instance.gitInfo = await this.getGitInfo(workspaceDir);
                    }
                }
            }

            // Fallback: Use just the window title or PID if we couldn't determine workspace
            if (!instance.workspacePath) {
                if (process.MainWindowTitle && process.MainWindowTitle !== 'Visual Studio Code') {
                    instance.name = `VS Code - ${process.MainWindowTitle}`;
                } else {
                    instance.name = `VS Code (PID: ${process.Id})`;
                }
            }

            return instance;
        } catch (error) {
            console.error('Error extracting instance info:', error);
            return null;
        }
    }

    /**
     * Extract workspace information from window title
     */
    private extractWorkspaceFromTitle(title: string): { name: string; path: string } | null {
        if (!title || title === 'Visual Studio Code') {
            return null;
        }

        // VS Code window titles typically follow patterns like:
        // "folder-name - Visual Studio Code"
        // "file.txt - folder-name - Visual Studio Code"
        // "● file.txt - folder-name - Visual Studio Code" (with unsaved changes)
        
        const parts = title.split(' - ');
        
        // Remove "Visual Studio Code" from the end if present
        if (parts.length > 1 && parts[parts.length - 1] === 'Visual Studio Code') {
            parts.pop();
        }
        
        if (parts.length === 0) {
            return null;
        }
        
        // If there's only one part, it's likely the workspace name
        if (parts.length === 1) {
            const workspaceName = parts[0].replace(/^●\s*/, '').trim(); // Remove unsaved indicator
            
            // Try to construct a likely path
            const possiblePaths = [
                path.join('C:', 'Users', os.userInfo().username, 'Documents', workspaceName),
                path.join('C:', 'Projects', workspaceName),
                path.join('C:', 'Code', workspaceName),
                path.join('C:', 'Repos', workspaceName),
                path.join('C:', 'dev', workspaceName),
                path.join('C:', workspaceName)
            ];
            
            for (const possiblePath of possiblePaths) {
                if (fs.existsSync(possiblePath)) {
                    return { name: workspaceName, path: possiblePath };
                }
            }
            
            // If no path found, still return the name
            return { name: workspaceName, path: workspaceName };
        }
        
        // If there are multiple parts, the last one is likely the workspace name
        const workspaceName = parts[parts.length - 1].trim();
        
        // Check if any part looks like a full path
        for (const part of parts) {
            const cleanPart = part.replace(/^●\s*/, '').trim();
            if (this.isValidPath(cleanPart) && fs.existsSync(cleanPart)) {
                return { name: path.basename(cleanPart), path: cleanPart };
            }
        }
        
        // Fallback to workspace name
        return { name: workspaceName, path: workspaceName };
    }

    /**
     * Extract recent file path from command line to infer workspace
     */
    private extractRecentFileFromCommandLine(commandLine: string): string | null {
        if (!commandLine) {
            return null;
        }
        
        // Look for file arguments that might indicate the workspace
        const args = this.parseCommandLine(commandLine);
        
        for (const arg of args) {
            // Skip VS Code flags and options
            if (arg.startsWith('-') || arg.startsWith('/')) {
                continue;
            }
            
            // Check if this looks like a file path
            if (this.isValidPath(arg)) {
                // If it's a file, return it; if it's a directory, that's the workspace
                if (fs.existsSync(arg)) {
                    const stats = fs.statSync(arg);
                    if (stats.isFile()) {
                        return arg; // Return the file path, caller will get directory
                    } else if (stats.isDirectory()) {
                        return path.join(arg, 'dummy.txt'); // Return a dummy file in the directory
                    }
                }
            }
            
            // Check for VS Code URI format
            if (arg.startsWith('vscode://')) {
                try {
                    const decoded = decodeURIComponent(arg);
                    const pathMatch = decoded.match(/vscode:\/\/[^\/]+\/(.+)/);
                    if (pathMatch && pathMatch[1]) {
                        const filePath = pathMatch[1].replace(/\//g, '\\');
                        if (this.isValidPath(filePath) && fs.existsSync(filePath)) {
                            return filePath;
                        }
                    }
                } catch (error) {
                    // Ignore URI parsing errors
                }
            }
        }
        
        return null;
    }

    /**
     * Parse command line string into arguments array
     */
    private parseCommandLine(commandLine: string): string[] {
        const args: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < commandLine.length; i++) {
            const char = commandLine[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ' ' && !inQuotes) {
                if (current.trim()) {
                    args.push(current.trim());
                    current = '';
                }
            } else {
                current += char;
            }
        }
        
        if (current.trim()) {
            args.push(current.trim());
        }
        
        return args;
    }

    /**
     * Extract workspace path from command line arguments
     */
    private extractWorkspacePath(args: string[]): string | undefined {
        // Look for workspace or folder arguments
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            
            // Check if this is a path argument (not starting with -)
            if (!arg.startsWith('-') && !arg.startsWith('/') && arg.includes('\\')) {
                // Verify it's a valid path
                if (this.isValidPath(arg)) {
                    return arg;
                }
            }
            
            // Check for specific flags that indicate workspace
            if ((arg === '--folder-uri' || arg === '--file-uri') && i + 1 < args.length) {
                return this.decodeURI(args[i + 1]);
            }
        }
        
        return undefined;
    }

    /**
     * Check if a string is a valid file system path
     */
    private isValidPath(pathStr: string): boolean {
        try {
            // Basic validation for Windows paths
            return /^[a-zA-Z]:\\.+/.test(pathStr) || pathStr.startsWith('\\\\');
        } catch {
            return false;
        }
    }

    /**
     * Decode URI if it's encoded
     */
    private decodeURI(uri: string): string {
        try {
            if (uri.startsWith('file://')) {
                return decodeURIComponent(uri.replace('file:///', '').replace(/\//g, '\\'));
            }
            return uri;
        } catch {
            return uri;
        }
    }

    /**
     * Parse memory from string format
     */
    private parseMemory(memoryStr: any): number {
        if (typeof memoryStr === 'number') {
            return Math.round(memoryStr / 1024 / 1024); // Convert to MB
        }
        
        if (typeof memoryStr === 'string') {
            // Remove any non-numeric characters except decimal points
            const numStr = memoryStr.replace(/[^\d.]/g, '');
            const num = parseFloat(numStr);
            
            if (memoryStr.toLowerCase().includes('k')) {
                return Math.round(num / 1024);
            } else if (memoryStr.toLowerCase().includes('m')) {
                return Math.round(num);
            } else {
                // Assume bytes, convert to MB
                return Math.round(num / 1024 / 1024);
            }
        }
        
        return 0;
    }

    /**
     * Calculate uptime from start time
     */
    private calculateUptime(startTime: any): string | undefined {
        if (!startTime) {
            return undefined;
        }
        
        try {
            const start = new Date(startTime);
            const now = new Date();
            const diffMs = now.getTime() - start.getTime();
            
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            
            if (hours > 0) {
                return `${hours}h ${minutes}m`;
            } else {
                return `${minutes}m`;
            }
        } catch {
            return undefined;
        }
    }

    /**
     * Focus a VS Code window by PID (Windows-specific)
     */
    async focusInstance(pid: number): Promise<void> {
        try {
            console.log(`Opening workspace for VS Code instance with PID: ${pid}`);

            // Get the workspace path for this PID
            const instances = await this.getVSCodeInstances();
            const targetInstance = instances.find(inst => inst.pid === pid);

            if (targetInstance && targetInstance.workspacePath && fs.existsSync(targetInstance.workspacePath)) {
                // Open workspace in current window
                const uri = vscode.Uri.file(targetInstance.workspacePath);
                await vscode.commands.executeCommand('vscode.openFolder', uri, false);
                vscode.window.showInformationMessage(`Opened workspace: ${path.basename(targetInstance.workspacePath)}`);
            } else {
                vscode.window.showWarningMessage(`Could not open workspace for VS Code instance (PID: ${pid}) - no workspace path available or path doesn't exist`);
            }

        } catch (error) {
            console.error('Error opening workspace:', error);
            vscode.window.showErrorMessage(`Failed to open workspace for VS Code instance (PID: ${pid}): ${error}`);
        }
    }

    /**
     * Get git information for a workspace path
     */
    async getGitInfo(workspacePath: string): Promise<GitInfo> {
        const gitInfo: GitInfo = {
            isGitRepo: false
        };

        try {
            // Check if .git directory exists
            const gitDir = path.join(workspacePath, '.git');
            if (!fs.existsSync(gitDir)) {
                return gitInfo;
            }

            gitInfo.isGitRepo = true;

            // Get current branch
            try {
                const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: workspacePath });
                gitInfo.branch = branchOutput.trim();
            } catch (error) {
                console.log('Could not get git branch:', error);
            }

            // Check for uncommitted changes
            try {
                const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: workspacePath });
                gitInfo.hasChanges = statusOutput.trim().length > 0;
            } catch (error) {
                console.log('Could not get git status:', error);
            }

            // Get remote URL
            try {
                const { stdout: remoteOutput } = await execAsync('git remote get-url origin', { cwd: workspacePath });
                gitInfo.remoteUrl = remoteOutput.trim();
            } catch (error) {
                console.log('Could not get remote URL:', error);
            }

            // Get last commit info
            try {
                const { stdout: commitOutput } = await execAsync('git log -1 --pretty=format:"%h %s"', { cwd: workspacePath });
                gitInfo.lastCommit = commitOutput.trim();
            } catch (error) {
                console.log('Could not get last commit:', error);
            }

            // Get ahead/behind info
            try {
                const { stdout: aheadBehindOutput } = await execAsync('git rev-list --left-right --count HEAD...@{u}', { cwd: workspacePath });
                const [ahead, behind] = aheadBehindOutput.trim().split('\t').map(Number);
                gitInfo.ahead = ahead;
                gitInfo.behind = behind;
            } catch (error) {
                console.log('Could not get ahead/behind info:', error);
            }

        } catch (error) {
            console.error('Error getting git info:', error);
        }

        return gitInfo;
    }

    /**
     * Get GitHub Copilot information for the current VS Code instance
     */
    async getCopilotInfo(): Promise<CopilotInfo> {
        const copilotInfo: CopilotInfo = {
            isInstalled: false,
            isActive: false,
            status: 'Unknown'
        };

        try {
            // GitHub Copilot extension ID
            const copilotExtensionId = 'github.copilot';
            const copilotExtension = vscode.extensions.getExtension(copilotExtensionId);

            if (!copilotExtension) {
                copilotInfo.status = 'Disabled';
                copilotInfo.detailHint = 'GitHub Copilot extension not installed';
                return copilotInfo;
            }

            copilotInfo.isInstalled = true;
            copilotInfo.version = copilotExtension.packageJSON?.version;

            const debug = process.env.BOT_BOSS_DEBUG || process.env.DEBUG;
            const log = (...args: any[]) => { if (debug) console.log('[BotBoss][CopilotDetect]', ...args); };

            if (!copilotExtension.isActive) {
                log('Copilot extension installed but not active. Attempting activation...');
                try {
                    await copilotExtension.activate();
                    log('Activation attempted, isActive=', copilotExtension.isActive);
                } catch (actErr) {
                    log('Activation error:', actErr);
                }
            }

            if (!copilotExtension.isActive) {
                copilotInfo.status = 'Disabled';
                copilotInfo.detailHint = 'Extension installed but inactive (maybe disabled per workspace)';
                return copilotInfo;
            }

            copilotInfo.isActive = true;

            // Try to get status from the extension's exports/API
            try {
                const copilotApi = copilotExtension.exports;
                log('Exports keys:', copilotApi ? Object.keys(copilotApi).slice(0, 25) : 'none');
                
                if (copilotApi) {
                    let rawStatus: any | undefined;
                    try {
                        if (typeof copilotApi.getStatus === 'function') {
                            rawStatus = await copilotApi.getStatus();
                            log('getStatus() returned:', rawStatus);
                        } else if (typeof copilotApi.status !== 'undefined') {
                            rawStatus = copilotApi.status;
                            log('Using exports.status:', rawStatus);
                        } else if (copilotApi.state) {
                            rawStatus = copilotApi.state;
                            log('Using exports.state:', rawStatus);
                        }
                    } catch (inner) {
                        log('Inner status retrieval error:', inner);
                    }
                    copilotInfo.status = this.mapCopilotStatus(rawStatus);
                    log('Mapped status after primary extraction:', copilotInfo.status);

                    // Heuristic: if API exposes an isGenerating flag
                    if (copilotApi.isGenerating || copilotApi.generating) {
                        if (copilotApi.isGenerating === true || copilotApi.generating === true) {
                            copilotInfo.status = 'Generating';
                            copilotInfo.detailHint = 'Copilot is currently producing output';
                            log('Overriding status to Generating due to isGenerating flag');
                        }
                    }

                    if (copilotApi.lastActivity) {
                        copilotInfo.lastActivity = copilotApi.lastActivity;
                    }
                } else {
                    copilotInfo.status = 'Idle';
                    log('No exports API, defaulting to Idle');
                }
            } catch (apiError) {
                log('Could not access Copilot API:', apiError);
                // Extension is active but API call failed - treat as Idle unless error message suggests otherwise
                copilotInfo.status = 'Idle';
            }

            // Fallback: if still Unknown but extension is active, treat as Idle so user sees usable state
            if (copilotInfo.status === 'Unknown' && copilotInfo.isActive) {
                copilotInfo.status = 'Idle';
                copilotInfo.detailHint = 'Active but no explicit status exposed; treating as Idle';
                log('Fallback applied: Unknown -> Idle');
            }

            // Additional status checks using VS Code commands (fallback method)
            try {
                // Check if Copilot commands are available
                const commands = await vscode.commands.getCommands(true);
                const copilotCommands = commands.filter(cmd => cmd.startsWith('github.copilot'));
                
                if (copilotCommands.length > 0) {
                    // Try to get status through commands
                    if (commands.includes('github.copilot.status')) {
                        try {
                            const status = await vscode.commands.executeCommand('github.copilot.status');
                            if (status) {
                                const mapped = this.mapCopilotStatus(status);
                                // Only overwrite if mapped provides more actionable state than existing
                                if (copilotInfo.status === 'Idle' || copilotInfo.status === 'Running' || copilotInfo.status === 'Unknown') {
                                    copilotInfo.status = mapped;
                                }
                            }
                        } catch (cmdError) {
                            console.log('Could not execute copilot status command:', cmdError);
                        }
                    }

                    // If sign-in command exists & status suggests auth problem
                    const signInCmd = commands.find(c => c.includes('copilot') && c.toLowerCase().includes('sign') && c.toLowerCase().includes('in'));
                    if (signInCmd && (copilotInfo.status === 'Unauthorized' || copilotInfo.status === 'SigninRequired')) {
                        copilotInfo.detailHint = 'Run Copilot sign-in command to authenticate';
                    }
                    
                    // Update last activity to current time if commands are available
                    copilotInfo.lastActivity = new Date().toISOString();
                }
            } catch (commandError) {
                log('Could not check Copilot commands:', commandError);
            }

        } catch (error) {
            console.error('Error getting Copilot info:', error);
            copilotInfo.error = error instanceof Error ? error.message : String(error);
            copilotInfo.status = 'Error';
            copilotInfo.detailHint = 'Unexpected error while querying Copilot';
        }

        return copilotInfo;
    }

    /**
     * Map various Copilot status values to our standard status types
     */
    private mapCopilotStatus(status: any): CopilotInfo['status'] {
        if (!status) return 'Unknown';

        const classify = (raw: string): CopilotInfo['status'] => {
            const s = raw.toLowerCase();
            if (/(sign.?in|required login|sign in)/.test(s)) return 'SigninRequired';
            if (/unauthori|forbidden|401|403/.test(s)) return 'Unauthorized';
            if (/rate.?limit|429/.test(s)) return 'RateLimited';
            if (/(approval|policy|waiting|pending review)/.test(s)) return 'Waiting for Approval';
            if (/(initializing|starting|loading|activating)/.test(s)) return 'Initializing';
            if (/(generating|computing|producing|inference|working)/.test(s)) return 'Generating';
            if (/(failed|failure)/.test(s)) return 'Failed';
            if (/(error|exception)/.test(s)) return 'Error';
            if (/(completed|done|success)/.test(s)) return 'Done';
            if (/(disabled|inactive|turned off)/.test(s)) return 'Disabled';
            if (/(idle|ready|running|active)/.test(s)) return 'Idle';
            return 'Unknown';
        };

        // Collect candidate strings via deep traversal (limited depth & size to avoid cycles)
        const visited = new Set<any>();
        const stack: any[] = [status];
        const MAX_NODES = 50; // safety cap
        let nodesProcessed = 0;
        while (stack.length && nodesProcessed < MAX_NODES) {
            const current = stack.pop();
            nodesProcessed++;
            if (current == null) continue;
            if (visited.has(current)) continue;
            if (typeof current === 'string') {
                const mapped = classify(current);
                if (mapped !== 'Unknown') return mapped;
            } else if (typeof current === 'object') {
                visited.add(current);
                // If object has a direct 'status' or 'state' string, prioritize
                const direct = (current.status || current.state || current.phase || current.mode);
                if (typeof direct === 'string') {
                    const mapped = classify(direct);
                    if (mapped !== 'Unknown') return mapped;
                }
                // Push nested values
                for (const key of Object.keys(current)) {
                    const val = (current as any)[key];
                    if (typeof val === 'string' || (typeof val === 'object' && val !== null)) {
                        stack.push(val);
                    }
                }
            }
        }
        return 'Unknown';
    }
}
