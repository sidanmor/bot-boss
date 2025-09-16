import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { VSCodeInstance, GitInfo, CopilotInfo } from './vscodeInstanceService';

export interface SharedInstanceData {
    pid: number;
    sessionId: string;
    instanceId: string; // GUID for consistent ordering
    name: string;
    workspacePath?: string;
    windowTitle?: string;
    gitInfo?: GitInfo;
    copilotInfo?: CopilotInfo;
    lastUpdated: number;
    startTime: number;
    memory: number;
}

export class SharedInstanceManager {
    private static instance: SharedInstanceManager;
    private readonly sharedFilePath: string;
    private readonly lockFilePath: string;
    private currentSessionId: string;
    private currentInstanceId: string; // GUID for this instance
    private heartbeatInterval?: NodeJS.Timeout;
    private readonly heartbeatIntervalMs = 5000; // 5 seconds for real-time updates
    private readonly staleThresholdMs = 15000; // 15 seconds (3x heartbeat)
    private fileWatcher?: fs.FSWatcher;
    private changeCallbacks: Set<() => void> = new Set();

    private constructor() {
        // Use a fixed, global shared file path for all users/instances
        let sharedFilePath: string;
        let lockFilePath: string;
        const platform = os.platform();
        if (platform === 'win32') {
            sharedFilePath = 'C:\\Users\\Public\\vscode-instances.json';
            lockFilePath = 'C:\\Users\\Public\\vscode-instances.lock';
        } else {
            sharedFilePath = '/tmp/vscode-instances.json';
            lockFilePath = '/tmp/vscode-instances.lock';
        }
        this.sharedFilePath = sharedFilePath;
        this.lockFilePath = lockFilePath;
        this.currentSessionId = this.generateSessionId();
        this.currentInstanceId = this.generateGUID();
        console.log(`[BotBoss] Using shared file: ${this.sharedFilePath}`);
        console.log(`[BotBoss] Instance ID: ${this.currentInstanceId}`);
    }

    public static getInstance(): SharedInstanceManager {
        if (!SharedInstanceManager.instance) {
            SharedInstanceManager.instance = new SharedInstanceManager();
        }
        return SharedInstanceManager.instance;
    }

    /**
     * Generate a unique session ID for this VS Code instance
     */
    private generateSessionId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 15);
        return `${process.pid}-${timestamp}-${random}`;
    }

    /**
     * Generate a GUID for consistent instance ordering
     */
    private generateGUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Register current VS Code instance to shared file
     */
    async registerCurrentInstance(): Promise<void> {
        try {
            const instanceData = await this.getCurrentInstanceData();
            await this.updateSharedFile(instanceData);
            
            // Start heartbeat to keep instance alive in shared file
            this.startHeartbeat();
            
            // Start watching the shared file for changes
            this.startFileWatcher();
            
            console.log(`Registered current instance with session ID: ${this.currentSessionId}`);
        } catch (error) {
            console.error('Failed to register current instance:', error);
            vscode.window.showErrorMessage(`Failed to register VS Code instance: ${error}`);
        }
    }

    /**
     * Get current instance data
     */
    private async getCurrentInstanceData(): Promise<SharedInstanceData> {
        const instanceData: SharedInstanceData = {
            pid: process.pid,
            sessionId: this.currentSessionId,
            instanceId: this.currentInstanceId,
            name: 'VS Code - Current Instance',
            lastUpdated: Date.now(),
            startTime: Date.now() - (process.uptime() * 1000),
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        };

        // Get workspace information
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceFolder = vscode.workspace.workspaceFolders[0];
            instanceData.workspacePath = workspaceFolder.uri.fsPath;
            instanceData.name = `VS Code - ${path.basename(workspaceFolder.uri.fsPath)}`;
            
            // Get git info for current workspace
            instanceData.gitInfo = await this.getGitInfo(workspaceFolder.uri.fsPath);
        } else if (vscode.workspace.name) {
            instanceData.name = `VS Code - ${vscode.workspace.name}`;
        }

        // Get GitHub Copilot info
        instanceData.copilotInfo = await this.getCopilotInfo();

        // Get window title from VS Code API if available
        try {
            // Try to get more detailed window information
            instanceData.windowTitle = vscode.workspace.name || instanceData.name;
        } catch (error) {
            console.log('Could not get window title:', error);
        }

        return instanceData;
    }

    /**
     * Simple git info extraction (simplified version)
     */
    private async getGitInfo(workspacePath: string): Promise<GitInfo> {
        const gitInfo: GitInfo = { isGitRepo: false };
        
        try {
            const gitDir = path.join(workspacePath, '.git');
            if (fs.existsSync(gitDir)) {
                gitInfo.isGitRepo = true;
                
                // Try to get current branch
                const headFile = path.join(gitDir, 'HEAD');
                if (fs.existsSync(headFile)) {
                    const headContent = fs.readFileSync(headFile, 'utf8').trim();
                    if (headContent.startsWith('ref: refs/heads/')) {
                        gitInfo.branch = headContent.substring('ref: refs/heads/'.length);
                    }
                }
                
                // Check for changes (simplified check)
                try {
                    const { execSync } = require('child_process');
                    const statusOutput = execSync('git status --porcelain', { 
                        cwd: workspacePath, 
                        timeout: 5000,
                        encoding: 'utf8'
                    });
                    gitInfo.hasChanges = statusOutput.trim().length > 0;
                } catch (gitError) {
                    // Git command failed, assume no changes
                    gitInfo.hasChanges = false;
                }
            }
        } catch (error) {
            console.log('Error getting git info:', error);
        }
        
        return gitInfo;
    }

    /**
     * Get GitHub Copilot information (simplified version for shared manager)
     */
    private async getCopilotInfo(): Promise<CopilotInfo> {
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
                return copilotInfo;
            }

            copilotInfo.isInstalled = true;
            copilotInfo.version = copilotExtension.packageJSON?.version;

            if (!copilotExtension.isActive) {
                copilotInfo.status = 'Disabled';
                return copilotInfo;
            }

            copilotInfo.isActive = true;

            // Simple status detection - assume running if active
            copilotInfo.status = 'Running';
            
            // Try basic API check
            try {
                const copilotApi = copilotExtension.exports;
                if (copilotApi && typeof copilotApi.getStatus === 'function') {
                    const status = await copilotApi.getStatus();
                    if (status) {
                        copilotInfo.status = this.mapCopilotStatus(status);
                    }
                }
            } catch (apiError) {
                // Keep default 'Running' status
            }

            copilotInfo.lastActivity = new Date().toISOString();

        } catch (error) {
            console.error('Error getting Copilot info in SharedInstanceManager:', error);
            copilotInfo.error = error instanceof Error ? error.message : String(error);
            copilotInfo.status = 'Failed';
        }

        return copilotInfo;
    }

    /**
     * Map Copilot status values (simplified version)
     */
    private mapCopilotStatus(status: any): CopilotInfo['status'] {
        if (typeof status === 'string') {
            const statusLower = status.toLowerCase();
            
            if (statusLower.includes('running') || statusLower.includes('active') || statusLower.includes('ready')) {
                return 'Running';
            } else if (statusLower.includes('waiting') || statusLower.includes('pending') || statusLower.includes('approval')) {
                return 'Waiting for Approval';
            } else if (statusLower.includes('failed') || statusLower.includes('error')) {
                return 'Failed';
            } else if (statusLower.includes('done') || statusLower.includes('completed')) {
                return 'Done';
            } else if (statusLower.includes('disabled')) {
                return 'Disabled';
            }
        }

        return 'Running'; // Default for active extension
    }

    /**
     * Update shared file with current instance data
     */
    private async updateSharedFile(instanceData: SharedInstanceData): Promise<void> {
        const maxRetries = 5;
        const retryDelay = 100; // ms

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.withFileLock(async () => {
                    // Read existing instances
                    const allInstances = await this.readSharedFile();
                    
                    // Remove any existing entry for this session
                    const filteredInstances = allInstances.filter(inst => inst.sessionId !== this.currentSessionId);
                    
                    // Add current instance
                    filteredInstances.push(instanceData);
                    
                    // Clean up stale instances while we're at it
                    const cleanInstances = this.removeStaleInstances(filteredInstances);
                    
                    // Sort instances by instanceId (GUID) to maintain consistent order
                    const sortedInstances = cleanInstances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
                    
                    // Write back to file
                    await this.writeSharedFile(sortedInstances);
                });
                
                return; // Success
            } catch (error) {
                console.log(`Attempt ${attempt + 1} failed:`, error);
                if (attempt === maxRetries - 1) {
                    throw error;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
            }
        }
    }

    /**
     * Read all instances from shared file
     */
    async getAllInstances(): Promise<VSCodeInstance[]> {
        try {
            const sharedInstances = await this.readSharedFile();
            console.log(`[BotBoss] SharedInstanceManager: Read ${sharedInstances.length} instances from shared file`);
            
            const cleanInstances = this.removeStaleInstances(sharedInstances);
            console.log(`[BotBoss] SharedInstanceManager: After removing stale instances: ${cleanInstances.length} instances`);
            
            // Sort instances by instanceId (GUID) to maintain consistent order
            const sortedInstances = cleanInstances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
            console.log(`[BotBoss] SharedInstanceManager: Sorted ${sortedInstances.length} instances by instanceId`);
            
            // Update file with clean instances if we removed any stale ones
            if (cleanInstances.length !== sharedInstances.length) {
                console.log(`[BotBoss] SharedInstanceManager: Removed ${sharedInstances.length - cleanInstances.length} stale instances`);
                await this.writeSharedFile(sortedInstances);
            }
            
            // Convert to VSCodeInstance format
            const result = sortedInstances.map(data => this.convertToVSCodeInstance(data));
            console.log(`[BotBoss] SharedInstanceManager: Returning ${result.length} instances to caller`);
            result.forEach((instance, index) => {
                console.log(`[BotBoss] SharedInstanceManager: Instance ${index + 1}: ${instance.name} (PID: ${instance.pid})`);
            });
            
            return result;
        } catch (error) {
            console.error('Failed to read instances from shared file:', error);
            return [];
        }
    }

    /**
     * Convert SharedInstanceData to VSCodeInstance
     */
    private convertToVSCodeInstance(data: SharedInstanceData): VSCodeInstance {
        const uptime = Math.floor((Date.now() - data.startTime) / 1000);
        
        let displayName = data.name;
        
        // If this is the current instance (same PID), enhance the display name but keep base token
        if (data.pid === process.pid) {
            console.log(`[BotBoss] Enhancing display name for current instance (PID: ${data.pid})`);

            let suffix: string | undefined;
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const workspaceFolder = vscode.workspace.workspaceFolders[0];
                const folderName = path.basename(workspaceFolder.uri.fsPath);
                suffix = folderName;
            } else if (vscode.workspace.name) {
                suffix = vscode.workspace.name;
            }

            if (suffix) {
                // Preserve original 'VS Code - Current Instance' string from shared file and append workspace
                if (/VS Code - Current Instance/i.test(displayName)) {
                    displayName = `${displayName} (${suffix})`;
                } else {
                    // Fallback if name was already transformed elsewhere
                    displayName = `VS Code - Current Instance (${suffix})`;
                }
                console.log(`[BotBoss] Display name with workspace: ${displayName}`);
            } else {
                console.log(`[BotBoss] No workspace info available, keeping original name: ${displayName}`);
            }
        }
        
        return {
            pid: data.pid,
            name: displayName,
            workspacePath: data.workspacePath,
            windowTitle: data.windowTitle,
            arguments: [], // Not available in shared data
            cpu: 0, // Not tracked in shared data
            memory: data.memory,
            uptime: this.calculateUptimeFromSeconds(uptime),
            gitInfo: data.gitInfo,
            copilotInfo: data.copilotInfo
        };
    }

    /**
     * Calculate uptime string from seconds
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
     * Read shared file with error handling
     */
    private async readSharedFile(): Promise<SharedInstanceData[]> {
        try {
            if (!fs.existsSync(this.sharedFilePath)) {
                console.log(`[BotBoss] Shared file does not exist: ${this.sharedFilePath}`);
                return [];
            }
            const content = fs.readFileSync(this.sharedFilePath, 'utf8');
            if (!content.trim()) {
                console.log(`[BotBoss] Shared file is empty: ${this.sharedFilePath}`);
                return [];
            }
            console.log(`[BotBoss] Read from shared file (${this.sharedFilePath}):\n${content}`);
            const data = JSON.parse(content);
            const instances = Array.isArray(data) ? data : [];
            
            // Ensure all instances have instanceId (for backward compatibility)
            return instances.map(instance => {
                if (!instance.instanceId) {
                    // Generate a deterministic instanceId based on sessionId for consistency
                    instance.instanceId = this.generateDeterministicGUID(instance.sessionId);
                    console.log(`[BotBoss] Added missing instanceId ${instance.instanceId} for session ${instance.sessionId}`);
                }
                return instance;
            });
        } catch (error) {
            console.log('Error reading shared file, creating new one:', error);
            return [];
        }
    }

    /**
     * Generate a deterministic GUID based on input string (for backward compatibility)
     */
    private generateDeterministicGUID(input: string): string {
        // Create a simple hash-based GUID from the input string
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash + input.charCodeAt(i)) & 0xffffffff;
        }
        
        // Convert hash to hex and pad to create GUID format
        const hex = Math.abs(hash).toString(16).padStart(8, '0');
        return `${hex.substr(0, 8)}-${hex.substr(0, 4)}-4${hex.substr(1, 3)}-${hex.substr(0, 4)}-${hex}${hex.substr(0, 4)}`;
    }

    /**
     * Write to shared file atomically
     */
    private async writeSharedFile(instances: SharedInstanceData[]): Promise<void> {
        const tempFilePath = this.sharedFilePath + '.tmp';
        const content = JSON.stringify(instances, null, 2);
        try {
            // Ensure parent directory exists
            const dir = path.dirname(this.sharedFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[BotBoss] Created directory for shared file: ${dir}`);
            }
            // Write to temp file first
            fs.writeFileSync(tempFilePath, content, 'utf8');
            // Atomic move
            fs.renameSync(tempFilePath, this.sharedFilePath);
            console.log(`[BotBoss] Wrote to shared file (${this.sharedFilePath}):\n${content}`);
        } catch (err) {
            console.error(`[BotBoss] Error writing to shared file (${this.sharedFilePath}):`, err);
            const error = err as NodeJS.ErrnoException;
            if (error && error.code === 'EACCES') {
                console.error(`[BotBoss] Permission denied. Try running VS Code as administrator or choose a different shared file location.`);
            }
        }
    }

    /**
     * Remove stale instances (not updated recently)
     */
    private removeStaleInstances(instances: SharedInstanceData[]): SharedInstanceData[] {
        const now = Date.now();
        console.log(`[BotBoss] SharedInstanceManager: Checking ${instances.length} instances for staleness (threshold: ${this.staleThresholdMs}ms)`);
        
        const filtered = instances.filter(instance => {
            const age = now - instance.lastUpdated;
            const isStale = age >= this.staleThresholdMs;
            
            console.log(`[BotBoss] SharedInstanceManager: Instance ${instance.sessionId} (PID: ${instance.pid}) - Age: ${age}ms, Stale: ${isStale}`);
            
            return !isStale;
        });
        
        console.log(`[BotBoss] SharedInstanceManager: Filtered ${instances.length} instances to ${filtered.length} (removed ${instances.length - filtered.length} stale)`);
        return filtered;
    }

    /**
     * Simple file locking mechanism
     */
    private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
        const maxWaitTime = 5000; // 5 seconds
        const checkInterval = 50; // 50ms
        const startTime = Date.now();

        // Wait for lock to be available
        while (fs.existsSync(this.lockFilePath)) {
            if (Date.now() - startTime > maxWaitTime) {
                // Force remove stale lock
                try {
                    fs.unlinkSync(this.lockFilePath);
                } catch (error) {
                    // Ignore error if file doesn't exist
                }
                break;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        // Create lock file
        try {
            fs.writeFileSync(this.lockFilePath, process.pid.toString());
            
            // Perform operation
            const result = await operation();
            
            return result;
        } finally {
            // Remove lock file
            try {
                fs.unlinkSync(this.lockFilePath);
            } catch (error) {
                // Ignore error if file doesn't exist
            }
        }
    }

    /**
     * Start heartbeat to keep instance alive
     */
    private startHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(async () => {
            try {
                const instanceData = await this.getCurrentInstanceData();
                await this.updateSharedFile(instanceData);
                console.log('Heartbeat updated instance data');
            } catch (error) {
                console.error('Heartbeat failed:', error);
                
                // Try to restart file watcher if it failed
                if (!this.fileWatcher) {
                    console.log('Attempting to restart file watcher...');
                    this.startFileWatcher();
                }
            }
        }, this.heartbeatIntervalMs);
    }

    /**
     * Start file system watcher for real-time updates
     */
    private startFileWatcher(): void {
        try {
            // Watch the directory containing the shared file
            const watchDir = path.dirname(this.sharedFilePath);
            
            this.fileWatcher = fs.watch(watchDir, (eventType, filename) => {
                if (filename === path.basename(this.sharedFilePath)) {
                    console.log(`Shared file changed: ${eventType}`);
                    // Notify all registered callbacks
                    this.changeCallbacks.forEach(callback => {
                        try {
                            callback();
                        } catch (error) {
                            console.error('Error in change callback:', error);
                        }
                    });
                }
            });
            
            console.log('Started file watcher for shared instances file');
        } catch (error) {
            console.error('Failed to start file watcher:', error);
        }
    }

    /**
     * Register callback for when shared file changes
     */
    onSharedFileChange(callback: () => void): void {
        this.changeCallbacks.add(callback);
    }

    /**
     * Unregister callback for shared file changes
     */
    offSharedFileChange(callback: () => void): void {
        this.changeCallbacks.delete(callback);
    }

    /**
     * Stop heartbeat and cleanup
     */
    async cleanup(): Promise<void> {
        console.log('Cleaning up SharedInstanceManager...');
        
        // Stop heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }

        // Stop file watcher
        if (this.fileWatcher) {
            this.fileWatcher.close();
            this.fileWatcher = undefined;
        }

        // Clear all callbacks
        this.changeCallbacks.clear();

        // Remove current instance from shared file
        try {
            await this.withFileLock(async () => {
                const allInstances = await this.readSharedFile();
                const filteredInstances = allInstances.filter(inst => inst.sessionId !== this.currentSessionId);
                // Sort remaining instances by instanceId (GUID) to maintain order
                const sortedInstances = filteredInstances.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
                await this.writeSharedFile(sortedInstances);
            });
            console.log('Removed current instance from shared file');
        } catch (error) {
            console.error('Failed to cleanup instance from shared file:', error);
        }
    }
}