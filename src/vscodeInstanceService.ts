import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface VSCodeInstance {
    pid: number;
    name: string;
    workspacePath?: string;
    windowTitle?: string;
    arguments: string[];
    cpu: number;
    memory: number;
    uptime?: string;
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
     * Get all running VS Code instances
     */
    async getVSCodeInstances(): Promise<VSCodeInstance[]> {
        try {
            const processes = await this.getVSCodeProcesses();
            const instances: VSCodeInstance[] = [];

            for (const process of processes) {
                const instance = await this.extractInstanceInfo(process);
                if (instance) {
                    instances.push(instance);
                }
            }

            return instances;
        } catch (error) {
            console.error('Error getting VS Code instances:', error);
            vscode.window.showErrorMessage(`Failed to get VS Code instances: ${error}`);
            return [];
        }
    }

    /**
     * Get VS Code processes using PowerShell on Windows
     */
    private async getVSCodeProcesses(): Promise<any[]> {
        try {
            // PowerShell command to get Code.exe processes with detailed info
            const command = `Get-Process -Name "Code" -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -eq "Code"} | Select-Object Id, ProcessName, CommandLine, CPU, WorkingSet, StartTime | ConvertTo-Json`;
            
            const { stdout } = await execAsync(`powershell.exe -Command "${command}"`);
            
            if (!stdout.trim()) {
                return [];
            }

            const result = JSON.parse(stdout);
            // Handle both single process (object) and multiple processes (array)
            return Array.isArray(result) ? result : [result];
        } catch (error) {
            console.error('Error getting processes:', error);
            
            // Fallback: try with tasklist if PowerShell fails
            try {
                const { stdout } = await execAsync('tasklist /fi "imagename eq Code.exe" /fo csv');
                const lines = stdout.split('\n').slice(1); // Skip header
                const processes = [];
                
                for (const line of lines) {
                    if (line.trim()) {
                        const parts = line.split(',').map(p => p.replace(/"/g, ''));
                        if (parts.length >= 2) {
                            processes.push({
                                Id: parseInt(parts[1]),
                                ProcessName: parts[0],
                                WorkingSet: parts[4] || '0',
                                CPU: 0,
                                CommandLine: '',
                                StartTime: null
                            });
                        }
                    }
                }
                return processes;
            } catch (fallbackError) {
                console.error('Fallback method also failed:', fallbackError);
                return [];
            }
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
                uptime: this.calculateUptime(process.StartTime)
            };

            // Try to get command line arguments for more details
            try {
                const cmdCommand = `wmic process where "ProcessId=${process.Id}" get CommandLine /format:value`;
                const { stdout: cmdStdout } = await execAsync(cmdCommand);
                
                const commandLineMatch = cmdStdout.match(/CommandLine=(.+)/);
                if (commandLineMatch && commandLineMatch[1]) {
                    const commandLine = commandLineMatch[1].trim();
                    instance.arguments = this.parseCommandLine(commandLine);
                    
                    // Extract workspace path from arguments
                    const workspacePath = this.extractWorkspacePath(instance.arguments);
                    if (workspacePath) {
                        instance.workspacePath = workspacePath;
                        instance.name = `VS Code - ${path.basename(workspacePath)}`;
                        instance.windowTitle = workspacePath;
                    }
                }
            } catch (cmdError) {
                console.log('Could not get command line for process:', process.Id);
            }

            return instance;
        } catch (error) {
            console.error('Error extracting instance info:', error);
            return null;
        }
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
            // PowerShell command to bring window to front
            const command = `
                Add-Type -TypeDefinition @"
                    using System;
                    using System.Runtime.InteropServices;
                    public class Win32 {
                        [DllImport("user32.dll")]
                        public static extern bool SetForegroundWindow(IntPtr hWnd);
                        [DllImport("user32.dll")]
                        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                        [DllImport("user32.dll")]
                        public static extern IntPtr GetMainWindowHandle(int processId);
                    }
"@
                $hwnd = [Win32]::GetMainWindowHandle(${pid})
                if ($hwnd -ne [IntPtr]::Zero) {
                    [Win32]::ShowWindow($hwnd, 9) # SW_RESTORE
                    [Win32]::SetForegroundWindow($hwnd)
                    Write-Output "Window focused successfully"
                } else {
                    Write-Output "Could not find window handle"
                }
            `;
            
            await execAsync(`powershell.exe -Command "${command}"`);
            vscode.window.showInformationMessage(`Focused VS Code instance (PID: ${pid})`);
        } catch (error) {
            console.error('Error focusing window:', error);
            vscode.window.showErrorMessage(`Failed to focus VS Code instance: ${error}`);
        }
    }
}